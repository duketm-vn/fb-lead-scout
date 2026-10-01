// E2E extension fb-lead-scout: Chromium thật + extension thật, facebook.com được thay bằng HTML mô phỏng
// (page.route), nên không chạm Facebook thật. Đăng nhập popup → trang group → News Feed → group mở bằng tên rút gọn.
const { chromium } = require('playwright');
const fs = require('fs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ext = '/work/ext';
  const groupFeed = fs.readFileSync('/work/group-feed.html', 'utf8');
  const newsFeed = fs.readFileSync('/work/news-feed.html', 'utf8');
  const page = (body) => ({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="vi"><body>${body}</body></html>` });
  const ctx = await chromium.launchPersistentContext('/tmp/profile', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1200, height: 800 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await ctx.route('https://www.facebook.com/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill(page(newsFeed));
    // Group mở bằng tên rút gọn: link thành viên trong trang dùng id số 777777777 (để extension học id số).
    if (path.startsWith('/groups/caphe.khoinghiep')) return route.fulfill(page(groupFeed.replaceAll('123456789', '777777777')));
    return route.fulfill(page(groupFeed));
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const scout = () => sw.evaluate(() => chrome.storage.local.get('scout').then((r) => r.scout));
  const until = async (fn, ms = 60000) => {
    for (let t = 0; t < ms; t += 1000) {
      await wait(1000);
      const s = await scout();
      if (s && fn(s)) return s;
    }
    return scout();
  };

  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 340, height: 600 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.screenshot({ path: '/work/1-popup-login.png' });
  await popup.fill('input[type=email]', process.env.EMAIL);
  await popup.fill('input[type=password]', process.env.PW);
  await popup.click('button:has-text("Đăng nhập")');
  await popup.waitForSelector('text=Đăng xuất', { timeout: 15000 });
  console.log('đăng nhập ok');

  const statusOf = () =>
    popup.evaluate(async () => {
      for (const t of await chrome.tabs.query({})) {
        try {
          const r = await chrome.tabs.sendMessage(t.id, { type: 'page:status' });
          if (r) return r;
        } catch {}
      }
      return null;
    });

  // 1. Trang group (id số)
  const fb = await ctx.newPage();
  await fb.goto('https://www.facebook.com/groups/123456789/');
  let s = await until((x) => x.stats.sent >= 4 && x.queue.length === 0);
  const g = await statusOf();
  console.log('[group] sent', s.stats.sent, 'found', g.found, 'tooOld', g.tooOld, 'noTime', g.noTime, 'noId', g.noId, 'lastError', s.lastError);

  // 2. News Feed (tự theo dõi đang bật, mặc định): 2 bài của group theo dõi + group lạ 555555555 được tự thêm
  //    rồi đọc; bạn bè/quảng cáo/bài cũ bị bỏ.
  await fb.goto('https://www.facebook.com/');
  s = await until((x) => x.stats.sent >= 7 && x.queue.length === 0, 40000);
  const f = await statusOf();
  console.log('[feed] sent', s.stats.sent, 'mode', f.mode, 'found', f.found, 'feedGroups', f.feedGroups, 'autoAdded', f.autoAdded, 'tooOld', f.tooOld, 'lastError', s.lastError);
  await popup.reload();
  await popup.waitForSelector('text=Hôm nay');
  await fb.bringToFront();
  await popup.bringToFront();
  await popup.screenshot({ path: '/work/2-popup-feed.png' });

  // 3. Group mở bằng tên rút gọn: extension học id số 777777777 và ghi vào CRM
  await fb.goto('https://www.facebook.com/groups/caphe.khoinghiep/');
  await wait(6000);
  const c = await statusOf();
  console.log('[slug] mode', c.mode, 'watched', c.watchedName);

  // 4. Tắt tự theo dõi ở popup → mở group lạ: không thêm group, không gửi gì thêm
  await popup.reload();
  await popup.waitForSelector('text=Tự theo dõi mọi group gặp được');
  await popup.click('text=Tự theo dõi mọi group gặp được');
  await wait(500);
  console.log('[tắt tự theo dõi] autoAdd =', await sw.evaluate(() => chrome.storage.local.get('scoutSettings').then((r) => r.scoutSettings?.autoAdd)));
  const before = (await scout()).stats.queued;
  await fb.goto('https://www.facebook.com/groups/khong.theo.doi/');
  await wait(3000);
  console.log('[không theo dõi] queued trước', before, 'sau', (await scout()).stats.queued);
  await ctx.close();
})().catch((e) => {
  console.error('LỖI', e);
  process.exit(1);
});
