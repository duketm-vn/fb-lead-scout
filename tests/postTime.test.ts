import { describe, expect, it } from 'vitest';
import { isTooOld, parsePostTime } from '../src/lib/postTime';

const NOW = new Date(2026, 9, 1, 12, 0); // 01/10/2026 12:00
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const p = (s: string) => parsePostTime(s, NOW);

describe('parsePostTime', () => {
  it('thời gian tương đối tiếng Việt và tiếng Anh', () => {
    expect(p('Vừa xong')).toEqual(NOW);
    expect(p('5 phút')).toEqual(at(2026, 10, 1, 11, 55));
    expect(p('2 giờ')).toEqual(at(2026, 10, 1, 10));
    expect(p('3 ngày')).toEqual(at(2026, 9, 28, 12));
    expect(p('1 tuần')).toEqual(at(2026, 9, 24, 12));
    expect(p('5m')).toEqual(at(2026, 10, 1, 11, 55));
    expect(p('2h')).toEqual(at(2026, 10, 1, 10));
    expect(p('3d')).toEqual(at(2026, 9, 28, 12));
    expect(p('1w')).toEqual(at(2026, 9, 24, 12));
  });

  it('hôm qua, có hoặc không có giờ', () => {
    expect(p('Hôm qua')).toEqual(at(2026, 9, 30, 23, 59)); // không có giờ: cuối ngày
    expect(p('Hôm qua lúc 21:15')).toEqual(at(2026, 9, 30, 21, 15));
    expect(p('Yesterday at 9:05 PM')).toEqual(at(2026, 9, 30, 21, 5));
  });

  it('ngày tuyệt đối, ngày không có năm rơi vào tương lai thì là năm trước', () => {
    expect(p('28 tháng 9 lúc 14:00')).toEqual(at(2026, 9, 28, 14));
    expect(p('5 tháng 3, 2025')).toEqual(at(2025, 3, 5, 23, 59));
    expect(p('25 tháng 12')).toEqual(at(2025, 12, 25, 23, 59));
    expect(p('September 28 at 2:00 PM')).toEqual(at(2026, 9, 28, 14));
    expect(p('Sep 28, 2025')).toEqual(at(2025, 9, 28, 23, 59));
  });

  it('chữ không phải giờ đăng hoặc bị xáo thì trả null', () => {
    for (const s of ['', 'ảnh', 'Xem thêm', 'gStnoerspdo', 'Người Thử Một', 'tháng 9']) expect(p(s)).toBeNull();
  });
});

describe('isTooOld', () => {
  it('quá 3 ngày mới coi là cũ', () => {
    expect(isTooOld(p('3 ngày')!, NOW)).toBe(false);
    expect(isTooOld(p('4 ngày')!, NOW)).toBe(true);
    // Chỉ có ngày thì coi là 23:59: 28/9 còn trong hạn, 27/9 lúc 10:00 đã quá 3 ngày.
    expect(isTooOld(p('28 tháng 9')!, NOW)).toBe(false);
    expect(isTooOld(p('27 tháng 9 lúc 10:00')!, NOW)).toBe(true);
  });
});
