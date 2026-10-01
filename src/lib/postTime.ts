// Giờ đăng bài suy ra từ chữ ở link giờ đăng ("2 giờ", "Hôm qua lúc 10:15", "28 tháng 9", "3d", "Sep 28").
// Facebook không có giờ đăng dạng máy đọc trong feed, và đôi khi xáo chữ ở chỗ này: không đọc được thì trả null
// (bài vẫn được gửi, chỉ không lọc theo tuổi được).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const RELATIVE: [RegExp, number][] = [
  [/^(\d+)\s*(phút|m|min|mins|minutes?)$/, MINUTE],
  [/^(\d+)\s*(giờ|h|hr|hrs|hours?)$/, HOUR],
  [/^(\d+)\s*(ngày|d|days?)$/, DAY],
  [/^(\d+)\s*(tuần|w|wk|wks|weeks?)$/, 7 * DAY],
  [/^(\d+)\s*(năm|y|yr|yrs|years?)$/, 365 * DAY],
];

const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function withTime(date: Date, text: string): Date {
  const t = text.match(/(\d{1,2}):(\d{2})\s*(am|pm|sa|ch)?/);
  if (t) {
    let h = Number(t[1]);
    const suffix = t[3];
    if ((suffix === 'pm' || suffix === 'ch') && h < 12) h += 12;
    if ((suffix === 'am' || suffix === 'sa') && h === 12) h = 0;
    date.setHours(h, Number(t[2]), 0, 0);
  } else date.setHours(23, 59, 0, 0); // chỉ có ngày: coi là cuối ngày để không loại nhầm bài còn trong hạn
  return date;
}

// Ngày không ghi năm mà rơi vào tương lai là của năm trước (vd "28 tháng 12" đọc vào tháng 1).
function absolute(day: number, month: number, year: number | null, text: string, now: Date): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = withTime(new Date(year ?? now.getFullYear(), month, day), text);
  if (year === null && d.getTime() > now.getTime() + DAY) d.setFullYear(d.getFullYear() - 1);
  return d;
}

export function parsePostTime(raw: string, now: Date = new Date()): Date | null {
  const text = raw.toLowerCase().replace(/\s+/g, ' ').replace(/[·•]/g, '').trim();
  if (!text || text.length > 60) return null;
  if (/^(vừa xong|just now|now)$/.test(text)) return new Date(now);
  for (const [re, unit] of RELATIVE) {
    const m = text.match(re);
    if (m) return new Date(now.getTime() - Number(m[1]) * unit);
  }
  if (/^(hôm qua|yesterday)\b/.test(text)) return withTime(new Date(now.getTime() - DAY), text);

  const vi = text.match(/^(\d{1,2}) tháng (\d{1,2})(?:,? (\d{4}))?/);
  if (vi) return absolute(Number(vi[1]), Number(vi[2]) - 1, vi[3] ? Number(vi[3]) : null, text, now);
  const viNum = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (viNum) return absolute(Number(viNum[1]), Number(viNum[2]) - 1, viNum[3] ? Number(viNum[3]) : null, text, now);
  const en = text.match(/^([a-z]{3})[a-z]* (\d{1,2})(?:,? (\d{4}))?/);
  if (en) {
    const month = MONTHS_EN.indexOf(en[1]!);
    if (month >= 0) return absolute(Number(en[2]), month, en[3] ? Number(en[3]) : null, text, now);
  }
  return null;
}

export const MAX_POST_AGE_DAYS = 3;

export function isTooOld(postedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - postedAt.getTime() > MAX_POST_AGE_DAYS * DAY;
}
