// Bộ khung ẩn danh của 1 bài để gỡ lỗi extractor khi Facebook đổi giao diện: chỉ giữ thẻ, role/aria, data-ad-*,
// dạng link (số → N, chữ → s) và độ dài chữ. Không chứa nội dung, tên hay id thật nên dán vào chat được.
const KEEP_ATTRS = ['role', 'aria-posinset', 'dir', 'data-ad-rendering-role', 'data-ad-comet-preview', 'data-ad-preview'];

// Đoạn đường dẫn cố định của Facebook giữ nguyên; id số → N, pfbid → pfbidX, còn lại (username, tên group) → s.
const PATH_WORDS = new Set(['groups', 'posts', 'permalink', 'user', 'photo', 'photo.php', 'profile.php', 'story.php', 'permalink.php', 'videos', 'watch', 'hashtag', 'events', 'reel', 'share']);

function maskHref(href: string): string {
  const [pathPart = '', query = ''] = href.replace(/^https?:\/\/[^/]+/, '').split('?');
  const path = pathPart
    .split('/')
    .map((seg) => (!seg || PATH_WORDS.has(seg) ? seg : /^\d+$/.test(seg) ? 'N' : /^pfbid/.test(seg) ? 'pfbidX' : seg === '#' ? '#' : 's'))
    .join('/');
  const keys = query ? '?' + query.split('&').map((kv) => (kv.split('=')[0] ?? '').replace(/[^\w\[\]]/g, '') + '=…').join('&') : '';
  return (path + keys).slice(0, 80);
}

export function skeleton(el: Element, depth = 0, maxDepth = 14): string {
  const attrs: string[] = [];
  for (const name of KEEP_ATTRS) {
    const v = el.getAttribute(name);
    if (v !== null) attrs.push(`${name}="${v}"`);
  }
  if (el.hasAttribute('aria-label')) attrs.push(`aria-label=[${el.getAttribute('aria-label')!.length}]`);
  if (el.tagName === 'A') attrs.push(`href="${maskHref(el.getAttribute('href') ?? '')}"`);
  const pad = '  '.repeat(depth);
  const kids = [...el.children];
  const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim();
  const line = `${pad}<${el.tagName.toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}>${ownText ? ` text[${ownText.length}]` : ''}`;
  if (depth >= maxDepth || kids.length === 0) return line + (kids.length ? ` …${kids.length} con` : '');
  // Chuỗi div chỉ có 1 con và không có thuộc tính đáng giữ: gộp lại cho gọn.
  if (kids.length === 1 && attrs.length === 0 && !ownText) return skeleton(kids[0]!, depth, maxDepth);
  return [line, ...kids.slice(0, 12).map((k) => skeleton(k, depth + 1, maxDepth)), kids.length > 12 ? `${pad}  …+${kids.length - 12}` : '']
    .filter(Boolean)
    .join('\n');
}
