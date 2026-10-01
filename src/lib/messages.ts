import type { ExtractedPost } from './extractor';

export interface GroupRef {
  fb_group_id: string | null;
  slug: string | null;
}

export interface WatchedGroup {
  id: string;
  name: string;
  fb_group_id: string | null;
  slug: string | null;
  enabled: boolean;
}

export interface DayStats {
  date: string; // YYYY-MM-DD giờ máy
  queued: number;
  sent: number;
  opportunities: number;
}

export interface BackgroundStatus {
  email: string | null;
  autoAdd: boolean;
  stats: DayStats;
  queueSize: number;
  lastError: string | null;
  lastSentAt: string | null;
}

export interface PageStatus {
  mode: 'group' | 'feed' | null; // trang 1 group / News Feed (lọc từng bài) / trang khác
  groupKey: string | null;
  watchedName: string | null; // group đang mở (mode group)
  watchedCount: number; // số group đang theo dõi
  autoAdded: number; // số group tự thêm từ lúc mở trang
  feedGroups: number; // mode feed: số group theo dõi đã gặp bài trên trang
  loggedIn: boolean;
  found: number;
  queued: number;
  noId: number;
  noContent: number;
  tooOld: number; // bài cũ hơn MAX_POST_AGE_DAYS, không gửi
  noTime: number; // bài đã gửi nhưng không đọc được giờ đăng
}

// Tin gửi tới background (content script + popup).
export type BgMessage =
  | { type: 'auth:login'; email: string; password: string }
  | { type: 'auth:logout' }
  | { type: 'status' }
  | { type: 'groups:list' }
  | { type: 'group:learn'; id: string; fb_group_id: string }
  | { type: 'group:add'; key: string; name: string }
  | { type: 'settings:set'; autoAdd: boolean }
  | { type: 'posts:add'; group: GroupRef; posts: ExtractedPost[] }
  | { type: 'flush' };

// Tin popup gửi tới content script của tab đang mở.
export type PageMessage = { type: 'page:status' } | { type: 'page:diagnose' };

export type Reply<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
