// E2E extension fb-lead-scout: Chromium thật + extension thật, trang facebook.com được thay bằng HTML giả lập
// (page.route), nên không chạm Facebook thật. Đăng nhập popup → mở group → chờ extension tự đọc + gửi lô.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const ext = '/work/ext';
  const fixture = fs.readFileSync('/work/group-feed.html', 'utf8');
  const ctx = await chromium.launchPersistentContext('/tmp/profile', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1200, height: 800 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await ctx.route('https://www.facebook.com/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="vi"><body>${fixture}</body></html>` }),
  );
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  console.log('extension id', extId);

  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 340, height: 560 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.screenshot({ path: '/work/1-popup-login.png' });
  await popup.fill('input[type=email]', process.env.EMAIL);
  await popup.fill('input[type=password]', process.env.PW);
  await popup.click('button:has-text("Đăng nhập")');
  await popup.waitForSelector('text=Đăng xuất', { timeout: 15000 });
  console.log('đăng nhập ok');

  const fb = await ctx.newPage();
  await fb.goto('https://www.facebook.com/groups/123456789/');

  const scout = () => sw.evaluate(() => chrome.storage.local.get('scout').then((r) => r.scout));
  let s;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    s = await scout();
    if (s && s.stats.sent >= 4 && s.queue.length === 0) break;
  }
  console.log('stats', JSON.stringify(s && s.stats), 'queue', s && s.queue.length, 'lastError', s && s.lastError);

  // Trạng thái content script trên tab facebook (popup thật lấy tab đang mở; ở đây hỏi thẳng tab).
  const pageStatus = await popup.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      try {
        const r = await chrome.tabs.sendMessage(t.id, { type: 'page:status' });
        if (r) return r;
      } catch {}
    }
    return null;
  });
  console.log('page', JSON.stringify(pageStatus));
  const diag = await popup.evaluate(async () => {
    for (const t of await chrome.tabs.query({})) {
      try { const r = await chrome.tabs.sendMessage(t.id, { type: 'page:diagnose' }); if (r) return r; } catch {}
    }
    return null;
  });
  console.log('diag dòng đầu:', diag && diag.split('\n').slice(0, 3).join(' | '));

  await popup.reload();
  await popup.waitForSelector('text=Hôm nay');
  await popup.screenshot({ path: '/work/2-popup-stats.png' });
  // Mô phỏng popup khi đang ở 1 group chưa theo dõi
  const fb2 = await ctx.newPage();
  await fb2.goto('https://www.facebook.com/groups/khong.theo.doi/');
  await new Promise((r) => setTimeout(r, 2500));
  const s2 = await scout();
  console.log('sau khi mở group không theo dõi, queued vẫn =', s2.stats.queued);
  await ctx.close();
})().catch((e) => {
  console.error('LỖI', e);
  process.exit(1);
});
