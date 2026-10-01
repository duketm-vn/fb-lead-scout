import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { ExtractedPost } from '../lib/extractor';
import type { BackgroundStatus, BgMessage, DayStats, GroupRef, Reply, WatchedGroup } from '../lib/messages';

// Background giữ hàng đợi bài trong chrome.storage.local (service worker MV3 bị tắt khi rảnh, biến trong bộ nhớ
// mất), gửi lô tối đa 20 bài/group lên Edge Function ingest-fb-posts. Lỗi mạng/5xx thì giữ lô, alarm 1 phút
// gửi lại. 400 (dữ liệu sai) thì bỏ lô để không kẹt mãi. Id đã gửi nhớ 3000 bài gần nhất để không gửi lại
// khi mở lại group (server cũng bỏ trùng, đây chỉ để đỡ request).

const BATCH = 20;
const SENT_IDS_MAX = 3000;
const GROUPS_TTL_MS = 5 * 60 * 1000;

interface QueueItem {
  groupKey: string;
  group: GroupRef;
  post: ExtractedPost;
}

interface State {
  queue: QueueItem[];
  sentIds: string[];
  stats: DayStats;
  lastError: string | null;
  lastSentAt: string | null;
}

const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD theo giờ máy
const emptyStats = (): DayStats => ({ date: today(), queued: 0, sent: 0, opportunities: 0 });

async function loadState(): Promise<State> {
  const s = (await browser.storage.local.get('scout')).scout as Partial<State> | undefined;
  const stats = s?.stats && s.stats.date === today() ? s.stats : emptyStats();
  return {
    queue: s?.queue ?? [],
    sentIds: s?.sentIds ?? [],
    stats,
    lastError: s?.lastError ?? null,
    lastSentAt: s?.lastSentAt ?? null,
  };
}

// Mọi thao tác đọc-sửa-ghi state đi qua chuỗi này để 2 sự kiện cùng lúc không ghi đè nhau.
let chain: Promise<unknown> = Promise.resolve();
function withState<T>(fn: (s: State) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const s = await loadState();
    const result = await fn(s);
    await browser.storage.local.set({ scout: s });
    return result;
  });
  chain = run.catch(() => undefined);
  return run;
}

let groupsCache: { at: number; groups: WatchedGroup[] } | null = null;

async function watchedGroups(force = false): Promise<WatchedGroup[]> {
  if (!force && groupsCache && Date.now() - groupsCache.at < GROUPS_TTL_MS) return groupsCache.groups;
  const { data, error } = await supabase.from('fb_watched_groups').select('id, name, fb_group_id, slug, enabled');
  if (error) throw new Error(error.message);
  groupsCache = { at: Date.now(), groups: (data ?? []) as WatchedGroup[] };
  return groupsCache.groups;
}

async function currentEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.email ?? null;
}

async function addPosts(group: GroupRef, posts: ExtractedPost[]) {
  const groupKey = group.fb_group_id ?? group.slug ?? '';
  const added = await withState((s) => {
    const known = new Set([...s.sentIds, ...s.queue.map((q) => q.post.fb_post_id)]);
    const fresh = posts.filter((p) => !known.has(p.fb_post_id));
    s.queue.push(...fresh.map((post) => ({ groupKey, group, post })));
    s.stats.queued += fresh.length;
    return fresh.length;
  });
  if (added > 0) scheduleFlush(added >= BATCH ? 0 : 5000);
  return added;
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush(delayMs: number) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delayMs);
}

async function describeError(error: unknown): Promise<{ message: string; status: number | null }> {
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    const body = await res.json().catch(() => ({}));
    return { message: body.error ?? `Lỗi ${res.status}`, status: res.status };
  }
  if (error instanceof FunctionsFetchError) return { message: 'Không kết nối được máy chủ CRM.', status: null };
  return { message: error instanceof Error ? error.message : String(error), status: null };
}

let flushing: Promise<void> | null = null;
function flush(): Promise<void> {
  flushing ??= doFlush().finally(() => (flushing = null));
  return flushing;
}

async function doFlush() {
  if (!(await currentEmail())) {
    await withState((s) => void (s.queue.length && (s.lastError = 'Chưa đăng nhập: bài đang chờ trong hàng đợi.')));
    return;
  }
  for (;;) {
    const first = (await loadState()).queue[0];
    if (!first) return;
    const chunk = (await loadState()).queue.filter((q) => q.groupKey === first.groupKey).slice(0, BATCH);
    const ids = new Set(chunk.map((q) => q.post.fb_post_id));

    const { data, error } = await supabase.functions.invoke('ingest-fb-posts', {
      body: { group: first.group, posts: chunk.map((q) => q.post) },
    });

    if (error) {
      const { message, status } = await describeError(error);
      const drop = status === 400; // dữ liệu sai: gửi lại cũng hỏng
      await withState((s) => {
        s.lastError = status === 401 ? 'Phiên đăng nhập hết hạn, hãy đăng nhập lại.' : message;
        if (drop) s.queue = s.queue.filter((q) => !ids.has(q.post.fb_post_id));
      });
      if (!drop) return; // để alarm gửi lại sau
      continue;
    }

    if (data?.skipped === 'group_not_watched') groupsCache = null;
    await withState((s) => {
      s.queue = s.queue.filter((q) => !ids.has(q.post.fb_post_id));
      s.sentIds = [...s.sentIds, ...ids].slice(-SENT_IDS_MAX);
      if (data?.skipped !== 'group_not_watched') {
        s.stats.sent += ids.size;
        s.stats.opportunities += Number(data?.opportunities ?? 0);
      }
      s.lastSentAt = new Date().toISOString();
      s.lastError = data?.alert_error ? `Đã lưu bài nhưng chưa báo được Telegram: ${data.alert_error}` : null;
    });
  }
}

async function handle(msg: BgMessage): Promise<Reply> {
  switch (msg.type) {
    case 'auth:login': {
      const { error } = await supabase.auth.signInWithPassword({ email: msg.email, password: msg.password });
      if (error) return { ok: false, error: error.message === 'Invalid login credentials' ? 'Sai email hoặc mật khẩu.' : error.message };
      groupsCache = null;
      void flush();
      return { ok: true, data: null };
    }
    case 'auth:logout': {
      await supabase.auth.signOut();
      groupsCache = null;
      return { ok: true, data: null };
    }
    case 'status': {
      const s = await loadState();
      const status: BackgroundStatus = {
        email: await currentEmail(),
        stats: s.stats,
        queueSize: s.queue.length,
        lastError: s.lastError,
        lastSentAt: s.lastSentAt,
      };
      return { ok: true, data: status };
    }
    case 'group:check': {
      if (!(await currentEmail())) return { ok: true, data: { loggedIn: false, group: null } };
      const groups = await watchedGroups();
      const match = groups.find((g) => g.enabled && msg.keys.some((k) => k === g.fb_group_id || k === g.slug)) ?? null;
      return { ok: true, data: { loggedIn: true, group: match } };
    }
    case 'posts:add':
      return { ok: true, data: await addPosts(msg.group, msg.posts) };
    case 'flush':
      await flush();
      return { ok: true, data: null };
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: BgMessage, _sender, sendResponse) => {
    handle(msg)
      .catch((err): Reply => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))
      .then(sendResponse);
    return true; // trả lời bất đồng bộ
  });
  browser.alarms.create('flush', { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'flush') void flush();
  });
});
