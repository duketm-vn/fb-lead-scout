import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractPost,
  findPostRoots,
  groupKeyFromPath,
  normalizeProfileUrl,
  numericGroupIdsIn,
} from '../src/lib/extractor';
import { skeleton } from '../src/lib/diagnose';

const html = readFileSync('tests/fixtures/group-feed.html', 'utf8');
const NOW = new Date(2026, 9, 1, 12, 0); // 01/10/2026 12:00 giờ máy

beforeEach(() => {
  document.body.innerHTML = html;
});

describe('groupKeyFromPath', () => {
  it('nhận id số và tên rút gọn, bỏ trang không phải 1 group', () => {
    expect(groupKeyFromPath('/groups/123456789/')).toBe('123456789');
    expect(groupKeyFromPath('/groups/caphe.khoinghiep/posts/1')).toBe('caphe.khoinghiep');
    expect(groupKeyFromPath('/groups/feed/')).toBeNull();
    expect(groupKeyFromPath('/groups/discover')).toBeNull();
    expect(groupKeyFromPath('/watch/')).toBeNull();
  });
});

describe('findPostRoots', () => {
  it('mỗi bài 1 khung, bình luận lồng bên trong không thành bài riêng', () => {
    expect(findPostRoots(document)).toHaveLength(7);
  });
});

describe('extractPost', () => {
  const posts = () => findPostRoots(document).map((r) => extractPost(r, '123456789', NOW));

  it('bài thường: id từ link giờ đăng, tác giả từ link trong group, bỏ qua bình luận', () => {
    const r = posts()[0]!;
    expect(r).toEqual({
      ok: true,
      post: {
        fb_post_id: '987654321',
        post_url: 'https://www.facebook.com/groups/123456789/posts/987654321/',
        posted_at: new Date(2026, 9, 1, 10, 0).toISOString(), // "2 giờ"
        author_name: 'Người Thử Một',
        author_url: 'https://www.facebook.com/groups/123456789/user/100000000000001/',
        content: expect.stringContaining('Quán 30 bàn'),
        truncated: false,
      },
    });
    if (r.ok) expect(r.post.content).not.toContain('Inbox em nhé');
  });

  it('bài bị "Xem thêm" cắt: đánh dấu truncated, bỏ chữ "Xem thêm"', () => {
    const r = posts()[1]!;
    expect(r.ok && r.post).toMatchObject({ fb_post_id: '111222333', truncated: true, author_url: 'https://www.facebook.com/nguoithu.hai' });
    if (r.ok) expect(r.post.content.endsWith('chọn thợ')).toBe(true);
    expect(r.ok && r.post.posted_at).toBe(new Date(2026, 8, 30, 23, 59).toISOString()); // "Hôm qua" không có giờ = cuối ngày
  });

  it('bài chia sẻ lại: lấy id bài của mình (pcb xuất hiện 2 lần), không lấy bài gốc', () => {
    const r = posts()[2]!;
    expect(r.ok && r.post.fb_post_id).toBe('444555666');
    expect(r.ok && r.post.post_url).toBe('https://www.facebook.com/groups/123456789/posts/444555666/');
    expect(r.ok && r.post.author_url).toBe('https://www.facebook.com/profile.php?id=100000000000003');
    expect(r.ok && r.post.posted_at).toBeNull(); // không có link giờ đăng
  });

  it('link giờ đăng chưa có href thì chưa đọc (no_id), bài chỉ có ảnh thì no_content', () => {
    expect(posts()[3]).toEqual({ ok: false, reason: 'no_id' });
    expect(posts()[4]).toEqual({ ok: false, reason: 'no_content' });
  });

  it('bài ẩn danh, id pfbid, group tên rút gọn, nội dung lấy từ khối dir="auto" dự phòng', () => {
    const r = posts()[5]!;
    expect(r.ok && r.post).toMatchObject({
      fb_post_id: 'pfbid02AbCdEfGhIjKlMnOp',
      post_url: 'https://www.facebook.com/groups/caphe.khoinghiep/posts/pfbid02AbCdEfGhIjKlMnOp/',
      author_name: 'Người tham gia ẩn danh',
      author_url: null,
      posted_at: new Date(2026, 8, 30, 12, 0).toISOString(), // "1 ngày"
    });
  });

  it('bài 2 tuần trước đọc được giờ đăng (content script sẽ bỏ qua vì quá 3 ngày)', () => {
    const r = posts()[6]!;
    expect(r.ok && r.post.posted_at).toBe(new Date(2026, 8, 17, 12, 0).toISOString());
  });
});

describe('normalizeProfileUrl', () => {
  it('bỏ tham số theo dõi, chặn link không phải hồ sơ', () => {
    expect(normalizeProfileUrl('/groups/123456789/user/2067980740767368/?__cft__[0]=x')).toBe(
      'https://www.facebook.com/groups/123456789/user/2067980740767368/',
    );
    expect(normalizeProfileUrl('/profile.php?id=100000000000007&ref=x')).toBe('https://www.facebook.com/profile.php?id=100000000000007');
    expect(normalizeProfileUrl('https://www.facebook.com/some.user?__tn__=R')).toBe('https://www.facebook.com/some.user');
    expect(normalizeProfileUrl('/groups/123456789/')).toBeNull();
    expect(normalizeProfileUrl('https://evil.example.com/x')).toBeNull();
  });
});

describe('numericGroupIdsIn', () => {
  it('thu id số của group từ các link trong trang', () => {
    expect(numericGroupIdsIn(document)).toEqual(expect.arrayContaining(['123456789', '999999999']));
  });
});

describe('skeleton (chẩn đoán)', () => {
  it('không chứa nội dung, tên hay id thật', () => {
    const out = findPostRoots(document).map((r) => skeleton(r)).join('\n');
    for (const secret of ['Người Thử', 'quán cafe', '987654321', '100000000000001', 'nguoithu', 'caphe.khoinghiep', 'pfbid02']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('data-ad-rendering-role="story_message"');
  });
});
