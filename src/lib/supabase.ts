import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import { browser } from 'wxt/browser';

// Chỉ background dùng client này (popup/content script nhắn qua background), nên chỉ 1 nơi làm mới token.
// Phiên đăng nhập lưu ở chrome.storage.local vì service worker MV3 không có localStorage và bị tắt khi rảnh.
const chromeStorage: SupportedStorage = {
  async getItem(key) {
    const v = (await browser.storage.local.get(key))[key];
    return typeof v === 'string' ? v : null;
  },
  async setItem(key, value) {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await browser.storage.local.remove(key);
  },
};

export const supabase = createClient(import.meta.env.WXT_SUPABASE_URL, import.meta.env.WXT_SUPABASE_ANON_KEY, {
  auth: { storage: chromeStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
