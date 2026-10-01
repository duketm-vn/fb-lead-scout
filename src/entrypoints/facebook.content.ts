import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import {
  dominantGroupId,
  extractPost,
  findPostRoots,
  groupKeyFromPath,
  groupKeysOf,
  isFeedPath,
  type ExtractedPost,
} from '../lib/extractor';
import { skeleton } from '../lib/diagnose';
import { isTooOld } from '../lib/postTime';
import type { BgMessage, GroupRef, PageMessage, PageStatus, Reply, WatchedGroup } from '../lib/messages';

// Chạy trên mọi trang facebook.com vì Facebook là SPA: chuyển trang không tải lại.
// Chỉ ĐỌC những gì đã hiện trên màn hình: không cuộn, không bấm "Xem thêm", không mở tab.
// - Trang 1 group (/groups/<key>): đọc mọi bài nếu group đó đang được theo dõi ở CRM.
// - News Feed (/, /groups/feed/): xét từng bài, chỉ đọc bài có link về group đang theo dõi; bài bạn bè, trang,
//   quảng cáo, group khác bị bỏ qua, không gửi gì.
// Bài cũ hơn MAX_POST_AGE_DAYS (đọc từ chữ ở link giờ đăng) không gửi; không đọc được giờ thì vẫn gửi.
// Mở group bằng tên rút gọn mà CRM chưa có id số: ghi id số học được vào CRM, vì News Feed hay dùng id số.

const GROUPS_TTL_MS = 5 * 60 * 1000;

function send<T>(msg: BgMessage): Promise<Reply<T>> {
  return browser.runtime.sendMessage(msg) as Promise<Reply<T>>;
}

const refOf = (g: WatchedGroup): GroupRef => ({ fb_group_id: g.fb_group_id, slug: g.slug });

function matchGroup(keys: string[], groups: WatchedGroup[]): WatchedGroup | null {
  for (const k of keys) {
    const g = groups.find((x) => k === x.fb_group_id || k === x.slug);
    if (g) return g;
  }
  return null;
}

export default defineContentScript({
  matches: ['https://www.facebook.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    let mode: PageStatus['mode'] = null;
    let pageKey: string | null = null;
    let lastPath = '';
    let groups: WatchedGroup[] = [];
    let groupsAt = 0;
    let loggedIn = false;
    let pageGroup: WatchedGroup | null = null; // mode group: group đang mở (đang theo dõi)
    const learned = new Set<string>();
    const found = new Set<string>();
    const queued = new Set<string>();
    const tooOld = new Set<string>();
    const noTime = new Set<string>();
    const feedGroups = new Set<string>();
    let noId = 0;
    let noContent = 0;
    const pending = new Map<string, { group: WatchedGroup; posts: ExtractedPost[] }>();

    async function loadGroups(force = false) {
      if (!force && Date.now() - groupsAt < GROUPS_TTL_MS) return;
      const reply = await send<{ loggedIn: boolean; groups: WatchedGroup[] }>({ type: 'groups:list' }).catch(() => null);
      if (!reply?.ok) return;
      loggedIn = reply.data.loggedIn;
      groups = reply.data.groups;
      groupsAt = Date.now();
    }

    async function onLocation(forceGroups = false) {
      const path = location.pathname;
      const key = groupKeyFromPath(path);
      mode = key ? 'group' : isFeedPath(path) ? 'feed' : null;
      pageKey = key;
      pageGroup = null;
      for (const s of [found, tooOld, noTime, feedGroups]) s.clear();
      noId = noContent = 0;
      if (!mode) return;
      await loadGroups(forceGroups);
      if (path !== location.pathname) return; // đã chuyển trang trong lúc chờ
      if (mode === 'group' && key) {
        const dominant = /^\d+$/.test(key) ? null : dominantGroupId(document);
        pageGroup = matchGroup([key, ...(dominant ? [dominant] : [])], groups);
        if (pageGroup && dominant && !pageGroup.fb_group_id && !learned.has(pageGroup.id)) {
          learned.add(pageGroup.id);
          const r = await send<boolean>({ type: 'group:learn', id: pageGroup.id, fb_group_id: dominant }).catch(() => null);
          if (r?.ok && r.data) await loadGroups(true);
        }
      }
      scan();
    }

    function scan() {
      if (!mode || !loggedIn) return;
      if (mode === 'group' && !pageGroup) return;
      void loadGroups(); // lướt News Feed lâu không đổi trang: danh sách group vẫn cập nhật (5 phút/lần)
      const misses = { noId: 0, noContent: 0 };
      const now = new Date();
      for (const root of findPostRoots(document)) {
        const group = mode === 'group' ? pageGroup : matchGroup(groupKeysOf(root), groups);
        if (!group) continue; // News Feed: bài không thuộc group theo dõi
        const r = extractPost(root, pageKey ?? group.fb_group_id ?? group.slug ?? '', now);
        if (!r.ok) {
          misses[r.reason === 'no_id' ? 'noId' : 'noContent'] += 1;
          continue;
        }
        const id = r.post.fb_post_id;
        if (r.post.posted_at && isTooOld(new Date(r.post.posted_at), now)) {
          tooOld.add(id);
          continue;
        }
        found.add(id);
        if (mode === 'feed') feedGroups.add(group.id);
        if (!r.post.posted_at) noTime.add(id);
        if (queued.has(id)) continue;
        queued.add(id);
        const bucket = pending.get(group.id) ?? { group, posts: [] };
        bucket.posts.push(r.post);
        pending.set(group.id, bucket);
      }
      // Số bài chưa đọc được tính theo lần quét gần nhất (bài có thể đọc được ở lần sau khi Facebook điền link).
      noId = misses.noId;
      noContent = misses.noContent;
      if (pending.size) flushSoon();
    }

    let sendTimer: number | null = null;
    function flushSoon() {
      if (sendTimer) return;
      sendTimer = ctx.setTimeout(async () => {
        sendTimer = null;
        const buckets = [...pending.values()];
        pending.clear();
        for (const { group, posts } of buckets) {
          const reply = await send({ type: 'posts:add', group: refOf(group), posts }).catch(() => null);
          // Extension vừa cập nhật/khởi động lại: content script cũ mất kết nối, bỏ đánh dấu để lần quét sau gửi lại.
          if (!reply?.ok) posts.forEach((p) => queued.delete(p.fb_post_id));
        }
      }, 2000);
    }

    let scanTimer: number | null = null;
    const observer = new MutationObserver(() => {
      if (!mode || scanTimer) return;
      scanTimer = ctx.setTimeout(() => {
        scanTimer = null;
        scan();
      }, 1500);
    });
    // Theo dõi cả thay đổi href: Facebook chỉ điền link giờ đăng (chứa id bài) khi rê chuột vào.
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    ctx.onInvalidated(() => observer.disconnect());

    ctx.setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        void onLocation();
      }
    }, 1000);

    browser.runtime.onMessage.addListener((msg: PageMessage, _sender, sendResponse) => {
      if (msg.type === 'page:status') {
        const status: PageStatus = {
          mode,
          groupKey: pageKey,
          watchedName: pageGroup?.name ?? null,
          watchedCount: groups.length,
          feedGroups: feedGroups.size,
          loggedIn,
          found: found.size,
          queued: queued.size,
          noId,
          noContent,
          tooOld: tooOld.size,
          noTime: noTime.size,
        };
        // Popup mở sau khi vừa đăng nhập hoặc vừa thêm group ở CRM: tải lại danh sách group.
        if (mode && (!loggedIn || (mode === 'group' && !pageGroup))) void onLocation(true);
        sendResponse(status);
      } else if (msg.type === 'page:diagnose') {
        const roots = findPostRoots(document).slice(0, 3);
        const where = isFeedPath(location.pathname) ? 'feed' : groupKeyFromPath(location.pathname) ? 'group' : 'khác';
        const header = `fb-lead-scout chẩn đoán · ${where} · ${new Date().toISOString()} · ${roots.length} khung bài\n`;
        sendResponse(header + roots.map((r, i) => `--- bài ${i + 1} ---\n${skeleton(r)}`).join('\n'));
      }
      return false;
    });
  },
});
