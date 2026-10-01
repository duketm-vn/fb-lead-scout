// Đọc bài trong Facebook Group từ DOM đang hiển thị. Chỉ ĐỌC: không bấm, không cuộn, không sửa trang.
//
// DOM của Facebook bị làm rối (class ngẫu nhiên, đổi thường xuyên), nên chỉ bám vào những thứ ổn định hơn:
// role/aria (role="article", aria-posinset), data-ad-* (Facebook dùng cho chính họ), và dạng URL của link
// (/groups/<group>/posts/<id>). Facebook đổi giao diện thì sửa ở file này; popup có nút "Sao chép chẩn đoán"
// (diagnose.ts) để lấy cấu trúc bài mà không lộ nội dung.

import { parsePostTime } from './postTime';

export interface ExtractedPost {
  fb_post_id: string;
  post_url: string;
  posted_at: string | null; // ISO, suy ra từ chữ ở link giờ đăng; null khi không đọc được
  author_name: string | null;
  author_url: string | null;
  content: string;
  truncated: boolean;
}

export type ExtractResult =
  | { ok: true; post: ExtractedPost }
  | { ok: false; reason: 'no_id' | 'no_content' };

// Đường dẫn /groups/<x> không phải 1 group cụ thể.
const RESERVED_GROUP_PATHS = new Set(['feed', 'discover', 'joins', 'notifications', 'create', 'search', 'you', 'category']);

export function groupKeyFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/groups\/([^/?#]+)/);
  if (!m) return null;
  const key = decodeURIComponent(m[1]!);
  if (RESERVED_GROUP_PATHS.has(key.toLowerCase())) return null;
  return /^[A-Za-z0-9._-]{1,100}$/.test(key) ? key : null;
}

// News Feed và trang tổng hợp "Nhóm": bài từ nhiều group lẫn với bài bạn bè/trang/quảng cáo, xét group từng bài.
export function isFeedPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/home.php' || /^\/groups\/feed\/?$/.test(pathname);
}

// Id số của group đang mở khi URL là tên rút gọn: id xuất hiện nhiều nhất trong link thành viên/bài của trang
// (/groups/<id>/user/..., /groups/<id>/posts/...). Cần ít nhất 3 lần để không lấy nhầm group của 1 bài chia sẻ.
export function dominantGroupId(root: ParentNode): string | null {
  const counts = new Map<string, number>();
  root.querySelectorAll<HTMLAnchorElement>('a[href*="/groups/"]').forEach((a) => {
    const m = (a.getAttribute('href') ?? '').match(/\/groups\/(\d{5,25})\/(?:user|posts|permalink)\//);
    if (m) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  });
  let best: [string, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  return best && best[1] >= 3 ? best[0] : null;
}

function isInside(el: Element, ancestors: Set<Element>): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) if (ancestors.has(p)) return true;
  return false;
}

// Khung của từng bài: phần tử có aria-posinset (bài trong feed), hoặc role="article" ngoài cùng.
// role="article" lồng bên trong 1 bài là bình luận, không tính.
export function findPostRoots(root: ParentNode): Element[] {
  const candidates = new Set<Element>();
  root.querySelectorAll('[aria-posinset]').forEach((el) => candidates.add(el));
  root.querySelectorAll('[role="article"]').forEach((el) => {
    if (!el.parentElement?.closest('[role="article"]')) candidates.add(el);
  });
  return [...candidates].filter((el) => !isInside(el, candidates));
}

// role="article" của chính bài: là khung bài, hoặc article đầu tiên bên trong khung aria-posinset.
function mainArticleOf(postRoot: Element): Element {
  return postRoot.getAttribute('role') === 'article' ? postRoot : (postRoot.querySelector('[role="article"]') ?? postRoot);
}

// Bình luận là role="article" nằm bên trong article của bài. Mọi thứ đọc từ bài phải bỏ qua phần này.
function inComment(el: Element, postRoot: Element): boolean {
  const main = mainArticleOf(postRoot);
  for (let p: Element | null = el; p && p !== postRoot; p = p.parentElement) {
    if (p !== main && p.getAttribute('role') === 'article') return true;
  }
  return false;
}

const POST_LINK = /\/groups\/([^/?#]+)\/(?:posts|permalink)\/(\d{5,30}|pfbid[0-9A-Za-z]{10,90})/;
const QUERY_POST_ID = [/[?&]multi_permalinks=(\d{5,30})/, /[?&]story_fbid=(\d{5,30})/, /[?&]set=pcb\.(\d{5,30})/];

// Id bài: lấy id xuất hiện nhiều nhất trong các link của bài (link giờ đăng, link bình luận, bộ ảnh pcb.*).
// Bài chia sẻ lại có thêm link tới bài gốc nhưng chỉ 1 lần, nên không bị chọn nhầm.
// Facebook chỉ điền href thật cho link giờ đăng khi rê chuột vào, nên bài có thể chưa có id ở lần đọc đầu;
// content script theo dõi thay đổi href để đọc lại.
export function postIdOf(postRoot: Element): { id: string; groupSegment: string | null } | null {
  const counts = new Map<string, { n: number; group: string | null; order: number }>();
  let order = 0;
  postRoot.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    let id: string | null = null;
    let group: string | null = null;
    const m = href.match(POST_LINK);
    if (m) {
      group = m[1]!;
      id = m[2]!;
    } else {
      for (const re of QUERY_POST_ID) {
        const q = href.match(re);
        if (q) {
          id = q[1]!;
          break;
        }
      }
    }
    if (!id) return;
    const prev = counts.get(id);
    if (prev) {
      prev.n += 1;
      prev.group ??= group;
    } else counts.set(id, { n: 1, group, order: order++ });
  });
  let best: [string, { n: number; group: string | null; order: number }] | null = null;
  for (const entry of counts) {
    if (!best || entry[1].n > best[1].n || (entry[1].n === best[1].n && entry[1].order < best[1].order)) best = entry;
  }
  return best ? { id: best[0], groupSegment: best[1].group } : null;
}

// Link giờ đăng = link tới chính bài (không nằm trong bình luận, chữ ngắn). Thử aria-label trước (có nơi
// Facebook ghi ngày đầy đủ ở đó), rồi tới chữ hiển thị.
function postedAtOf(postRoot: Element, postId: string, now: Date): Date | null {
  for (const a of postRoot.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (inComment(a, postRoot)) continue;
    const href = a.getAttribute('href') ?? '';
    const m = href.match(POST_LINK);
    const linksHere = (m && m[2] === postId) || QUERY_POST_ID.slice(0, 2).some((re) => href.match(re)?.[1] === postId);
    if (!linksHere || href.includes('comment_id')) continue;
    for (const candidate of [a.getAttribute('aria-label'), a.textContent]) {
      const t = candidate?.trim();
      if (!t || t.length > 60) continue;
      const d = parsePostTime(t, now);
      if (d) return d;
    }
  }
  return null;
}

const RESERVED_PROFILE_PATHS = new Set(['groups', 'watch', 'events', 'marketplace', 'gaming', 'pages', 'photo', 'photo.php', 'stories', 'hashtag', 'reel', 'share']);

// Link người đăng → link hồ sơ gọn, không kèm tham số theo dõi của Facebook.
// Link thành viên trong group (/groups/<g>/user/<id>/) giữ nguyên dạng đó: id ở đây không mở được bằng
// profile.php?id= (đã gặp: mọi hồ sơ đổi sang profile.php đều "không hiển thị").
export function normalizeProfileUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, 'https://www.facebook.com');
  } catch {
    return null;
  }
  if (!/(^|\.)facebook\.com$/.test(url.hostname)) return null;
  const groupUser = url.pathname.match(/^\/groups\/([A-Za-z0-9._-]+)\/user\/(\d{5,25})/);
  if (groupUser) return `https://www.facebook.com/groups/${groupUser[1]}/user/${groupUser[2]}/`;
  if (url.pathname === '/profile.php') {
    const id = url.searchParams.get('id');
    return id && /^\d{5,25}$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : null;
  }
  const user = url.pathname.match(/^\/([A-Za-z0-9.]{3,80})\/?$/);
  if (user && !RESERVED_PROFILE_PATHS.has(user[1]!.toLowerCase())) return `https://www.facebook.com/${user[1]}`;
  return null;
}

// Link về trang chủ group (/groups/<g>/), không phải link thành viên /groups/<g>/user/<id>/.
const GROUP_HOME_LINK = /\/groups\/[^/?#]+\/?(?:[?#]|$)/;

function authorOf(postRoot: Element): { name: string | null; url: string | null } {
  const selectors = [
    '[data-ad-rendering-role="profile_name"] a[href]',
    'h2 a[href]',
    'h3 a[href]',
    'h4 a[href]',
  ];
  for (const sel of selectors) {
    for (const a of postRoot.querySelectorAll<HTMLAnchorElement>(sel)) {
      // Trên News Feed, đầu bài group có link tên group đứng trước tên người đăng.
      if (inComment(a, postRoot) || GROUP_HOME_LINK.test(a.getAttribute('href') ?? '')) continue;
      const name = a.textContent?.trim() || null;
      if (!name) continue;
      return { name: name.slice(0, 150), url: normalizeProfileUrl(a.getAttribute('href') ?? '') };
    }
  }
  // Bài ẩn danh: tên không có link.
  const plain = postRoot.querySelector('[data-ad-rendering-role="profile_name"]');
  return { name: plain?.textContent?.trim().slice(0, 150) || null, url: null };
}

const SEE_MORE = /^(xem thêm|see more)$/i;

function textOf(el: Element): string {
  const html = el as HTMLElement;
  return (typeof html.innerText === 'string' && html.innerText.length > 0 ? html.innerText : el.textContent ?? '').trim();
}

function contentOf(postRoot: Element): { text: string; truncated: boolean } | null {
  const selectors = [
    '[data-ad-rendering-role="story_message"]',
    '[data-ad-comet-preview="message"]',
    '[data-ad-preview="message"]',
  ];
  let message: Element | null = null;
  for (const sel of selectors) {
    message = [...postRoot.querySelectorAll(sel)].find((el) => !inComment(el, postRoot)) ?? null;
    if (message) break;
  }
  if (!message) {
    // Dự phòng: khối chữ dir="auto" dài nhất ngoài phần bình luận và tên người đăng.
    let best: Element | null = null;
    let bestLen = 0;
    postRoot.querySelectorAll('div[dir="auto"]').forEach((el) => {
      if (inComment(el, postRoot) || el.closest('h2, h3, h4')) return;
      const len = (el.textContent ?? '').trim().length;
      if (len > bestLen) {
        best = el;
        bestLen = len;
      }
    });
    message = bestLen >= 20 ? best : null;
  }
  if (!message) return null;

  const seeMore = [...message.querySelectorAll('[role="button"]')].filter((b) => SEE_MORE.test(b.textContent?.trim() ?? ''));
  let text = textOf(message);
  for (const b of seeMore) {
    const label = b.textContent?.trim() ?? '';
    if (label && text.endsWith(label)) text = text.slice(0, -label.length).trimEnd();
  }
  text = text.replace(/\n{3,}/g, '\n\n').replace(/…\s*$/, '').trim();
  return text ? { text, truncated: seeMore.length > 0 } : null;
}

// Group của 1 bài (dùng trên News Feed): đoạn group trong link bài trước, rồi tới mọi link /groups/<g>/ ngoài
// phần bình luận (tên group ở đầu bài, link thành viên). Bài bạn bè/trang/quảng cáo không có link nào → [].
export function groupKeysOf(postRoot: Element): string[] {
  const keys: string[] = [];
  const own = postIdOf(postRoot)?.groupSegment;
  if (own) keys.push(own);
  postRoot.querySelectorAll<HTMLAnchorElement>('a[href*="/groups/"]').forEach((a) => {
    if (inComment(a, postRoot)) return;
    const m = (a.getAttribute('href') ?? '').match(/\/groups\/([A-Za-z0-9._-]{1,100})(?:[/?#]|$)/);
    if (m && !keys.includes(m[1]!) && groupKeyFromPath(`/groups/${m[1]}`)) keys.push(m[1]!);
  });
  return keys;
}

// Tên + link của group mà bài thuộc về (để tự thêm group vào danh sách theo dõi): link trang chủ group có chữ,
// ưu tiên link cùng group với link bài. null với bài không thuộc group nào.
export function groupInfoOf(postRoot: Element): { key: string; name: string } | null {
  const keys = groupKeysOf(postRoot);
  if (!keys.length) return null;
  let named: { key: string; name: string } | null = null;
  for (const a of postRoot.querySelectorAll<HTMLAnchorElement>('a[href*="/groups/"]')) {
    if (inComment(a, postRoot)) continue;
    const href = a.getAttribute('href') ?? '';
    const m = href.match(/\/groups\/([A-Za-z0-9._-]{1,100})(?:[/?#]|$)/);
    const name = a.textContent?.trim();
    if (!m || !name || !GROUP_HOME_LINK.test(href)) continue;
    if (m[1] === keys[0]) return { key: keys[0]!, name: name.slice(0, 150) };
    named ??= { key: m[1]!, name: name.slice(0, 150) };
  }
  return named && keys.includes(named.key) ? named : { key: keys[0]!, name: keys[0]! };
}

// Tên group trên trang group: lấy từ tiêu đề tab ("(3) Tên group | Facebook").
export function groupNameFromTitle(title: string): string | null {
  const name = title.replace(/^\(\d+\+?\)\s*/, '').replace(/\s*\|\s*Facebook\s*$/i, '').trim();
  return name && name.toLowerCase() !== 'facebook' ? name.slice(0, 150) : null;
}

export function extractPost(postRoot: Element, pageGroupKey: string, now: Date = new Date()): ExtractResult {
  const idInfo = postIdOf(postRoot);
  if (!idInfo) return { ok: false, reason: 'no_id' };
  const content = contentOf(postRoot);
  if (!content) return { ok: false, reason: 'no_content' };
  const author = authorOf(postRoot);
  const group = idInfo.groupSegment ?? pageGroupKey;
  return {
    ok: true,
    post: {
      fb_post_id: idInfo.id,
      post_url: `https://www.facebook.com/groups/${group}/posts/${idInfo.id}/`,
      posted_at: postedAtOf(postRoot, idInfo.id, now)?.toISOString() ?? null,
      author_name: author.name,
      author_url: author.url,
      content: content.text,
      truncated: content.truncated,
    },
  };
}
