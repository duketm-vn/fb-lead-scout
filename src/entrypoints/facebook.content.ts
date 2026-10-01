import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { extractPost, findPostRoots, groupKeyFromPath, numericGroupIdsIn, type ExtractedPost } from '../lib/extractor';
import { skeleton } from '../lib/diagnose';
import { isTooOld } from '../lib/postTime';
import type { BgMessage, GroupRef, PageMessage, PageStatus, Reply, WatchedGroup } from '../lib/messages';

// Chạy trên mọi trang facebook.com vì Facebook là SPA: từ News Feed bấm sang group không tải lại trang.
// Chỉ ĐỌC những gì đã hiện trên màn hình: không cuộn, không bấm "Xem thêm", không mở tab. Chỉ làm việc khi
// URL là 1 group nằm trong danh sách theo dõi ở CRM (background kiểm tra), ngoài ra không gửi gì.
// Bài cũ hơn MAX_POST_AGE_DAYS (đọc từ chữ ở link giờ đăng) không gửi: gần như hết cơ hội, đỡ phí Claude.
// Không đọc được giờ đăng thì vẫn gửi để không sót.

function send<T>(msg: BgMessage): Promise<Reply<T>> {
  return browser.runtime.sendMessage(msg) as Promise<Reply<T>>;
}

export default defineContentScript({
  matches: ['https://www.facebook.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    let pageKey: string | null = null;
    let lastPath = '';
    let watched: WatchedGroup | null = null;
    let loggedIn = false;
    let groupRef: GroupRef | null = null;
    const found = new Set<string>();
    const queued = new Set<string>();
    const tooOld = new Set<string>();
    const noTime = new Set<string>();
    let noId = 0;
    let noContent = 0;
    let pending: ExtractedPost[] = [];

    async function onLocation() {
      const key = groupKeyFromPath(location.pathname);
      if (key === pageKey && watched) return;
      pageKey = key;
      watched = null;
      groupRef = null;
      found.clear();
      tooOld.clear();
      noTime.clear();
      noId = noContent = 0;
      if (!key) return;
      const numericIds = numericGroupIdsIn(document);
      const reply = await send<{ loggedIn: boolean; group: WatchedGroup | null }>({ type: 'group:check', keys: [key, ...numericIds] });
      if (!reply.ok || key !== pageKey) return;
      loggedIn = reply.data.loggedIn;
      watched = reply.data.group;
      if (watched) {
        const numeric = /^\d+$/.test(key) ? key : watched.fb_group_id;
        groupRef = { fb_group_id: numeric ?? null, slug: /^\d+$/.test(key) ? watched.slug : key };
        scan();
      }
    }

    function scan() {
      if (!watched || !pageKey || !groupRef) return;
      const misses = { noId: 0, noContent: 0 };
      const now = new Date();
      for (const root of findPostRoots(document)) {
        const r = extractPost(root, pageKey, now);
        if (!r.ok) {
          misses[r.reason === 'no_id' ? 'noId' : 'noContent'] += 1;
          continue;
        }
        if (r.post.posted_at && isTooOld(new Date(r.post.posted_at), now)) {
          tooOld.add(r.post.fb_post_id);
          continue;
        }
        found.add(r.post.fb_post_id);
        if (!r.post.posted_at) noTime.add(r.post.fb_post_id);
        if (queued.has(r.post.fb_post_id)) continue;
        queued.add(r.post.fb_post_id);
        pending.push(r.post);
      }
      // Số bài chưa đọc được tính theo lần quét gần nhất (bài có thể đọc được ở lần sau khi Facebook điền link).
      noId = misses.noId;
      noContent = misses.noContent;
      if (pending.length) flushSoon();
    }

    let sendTimer: number | null = null;
    function flushSoon() {
      if (sendTimer) return;
      sendTimer = ctx.setTimeout(async () => {
        sendTimer = null;
        const batch = pending;
        pending = [];
        if (!groupRef || !batch.length) return;
        const reply = await send({ type: 'posts:add', group: groupRef, posts: batch }).catch(() => null);
        // Extension vừa cập nhật/khởi động lại: content script cũ mất kết nối, trả bài về để lần sau gửi.
        if (!reply?.ok) {
          pending.push(...batch);
          batch.forEach((p) => queued.delete(p.fb_post_id));
        }
      }, 2000);
    }

    let scanTimer: number | null = null;
    const observer = new MutationObserver(() => {
      if (!watched || scanTimer) return;
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
          groupKey: pageKey,
          group: groupRef,
          watchedName: watched?.name ?? null,
          loggedIn,
          found: found.size,
          queued: queued.size,
          noId,
          noContent,
          tooOld: tooOld.size,
          noTime: noTime.size,
        };
        // Popup mở sau khi vừa đăng nhập: kiểm tra lại group.
        if (pageKey && !watched) void onLocation();
        sendResponse(status);
      } else if (msg.type === 'page:diagnose') {
        const roots = findPostRoots(document).slice(0, 3);
        const header = `fb-lead-scout chẩn đoán · ${new Date().toISOString()} · ${roots.length} khung bài\n`;
        sendResponse(header + roots.map((r, i) => `--- bài ${i + 1} ---\n${skeleton(r)}`).join('\n'));
      }
      return false;
    });
  },
});
