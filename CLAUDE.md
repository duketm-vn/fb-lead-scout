# CLAUDE.md

Chrome extension (MV3) đọc thụ động bài từ Facebook Group đang theo dõi (trang group + News Feed), gửi lên Edge Function `ingest-fb-posts` của
Supabase CRM (`../portfolio-ducdev`, migration 0010) để Claude chấm cơ hội làm app/web. Phía sau (bảng, RPC, Edge
Function, trang CRM, bot Telegram riêng) nằm hết ở portfolio, xem CLAUDE.md bên đó.

## Commands

```bash
npm install          # postinstall chạy wxt prepare (sinh .wxt/ và kiểu)
npm run dev          # WXT dev, tự mở Chromium có extension (trên WSL thường không mở được, dùng build + Load unpacked)
npm run build        # → .output/chrome-mv3 (Load unpacked ở chrome://extensions)
npm run lint         # tsc --noEmit
npm test             # vitest + happy-dom: extractor + chẩn đoán trên tests/fixtures/group-feed.html
npm run e2e          # sau build: Chromium thật trên server (Playwright Docker), facebook.com thay bằng fixture
npm run icons        # scripts/icon.svg → public/icon/*.png (sharp)
```

`npm run e2e` (`scripts/e2e-remote.sh`) dùng lại image `demo-recorder:1.63` và `~/demo-recorder/node_modules` trên
server (`NODE_PATH`), tạo user + group "TEST e2e" tạm trên Supabase CRM, gửi bài **thật** qua `ingest-fb-posts`
(tốn phí Claude, bot cơ hội có thể nhắn Telegram), rồi xoá sạch. Cần `../portfolio-ducdev` đã `supabase link`.

## Env

`.env` (gitignored, xem `.env.example`): `WXT_SUPABASE_URL`, `WXT_SUPABASE_ANON_KEY` (anon key công khai của CRM,
quyền thật ở RLS + function tự `auth.getUser()`), `WXT_CRM_URL` (nút mở trang Cơ hội FB). Biến đọc lúc build.

## Architecture

```
facebook.content.ts (mọi trang facebook.com, vì Facebook là SPA)
  └─ lấy danh sách group đang theo dõi từ background (groups:list, cache 5 phút ở cả 2 phía)
  └─ /groups/<key>: đọc mọi bài nếu group khớp; / hoặc /groups/feed/ (News Feed): groupKeysOf từng bài, chỉ bài
     khớp group theo dõi; còn lại bỏ qua
  └─ MutationObserver (childList + href) → extractor → gửi bài mới (theo từng group) cho background sau 2 giây
  └─ mở group bằng tên rút gọn, CRM chưa có id số: dominantGroupId → group:learn điền fb_group_id (chỉ ô trống)
background.ts (service worker)
  └─ supabase-js, phiên lưu chrome.storage.local; hàng đợi + id đã gửi (3000) + số liệu ngày trong storage
  └─ gửi lô ≤ 20 bài/group: functions.invoke('ingest-fb-posts'); lỗi mạng/5xx/401 giữ lô, alarm 1 phút gửi lại;
     400 bỏ lô. Phân biệt FunctionsHttpError (đọc context.json()) với FunctionsFetchError.
popup/App.tsx
  └─ đăng nhập, trạng thái tab đang mở (hỏi content script), số liệu ngày, Gửi ngay, Sao chép chẩn đoán
```

Quyết định cố ý:
- **Chỉ đọc thụ động** (không cuộn, không bấm "Xem thêm", không tự mở group) để Facebook không coi là bot.
  Đừng thêm tự cuộn/tự mở tab dù tiện.
- **Không gửi gì từ group chưa theo dõi**: content script lọc theo danh sách, server kiểm lại lần nữa. Trên News
  Feed khớp theo **link** (id số/tên rút gọn trong link bài, link tên group), không theo tên nhóm (tên đặt ở CRM có
  thể khác tên thật, tên thật trùng/đổi được). Đầu bài News Feed có link tên group trước tên người đăng: authorOf
  bỏ qua link trang chủ group.
- **Tự học id số**: News Feed thường dùng id số, người dùng hay dán link tên rút gọn. Mở trang group thì id số xuất
  hiện nhiều nhất (≥ 3 lần) trong link thành viên/bài được ghi vào `fb_watched_groups.fb_group_id` (RLS admin).
- **Chỉ background giữ Supabase client**: popup/content script nhắn qua `runtime.sendMessage`, nên chỉ 1 nơi
  làm mới token.
- **Extractor (`src/lib/extractor.ts`) chỉ bám role/aria, `data-ad-*` và dạng URL**, không bám class (bị làm rối).
  Khung bài = `[aria-posinset]` hoặc `role="article"` ngoài cùng; `role="article"` lồng trong article của bài là
  bình luận. Id bài = id xuất hiện nhiều nhất trong link của bài (`/posts/<id>`, `/permalink/<id>`, `pfbid…`,
  `set=pcb.<id>`), để bài chia sẻ lại không lấy nhầm id bài gốc. Link giờ đăng chỉ có href khi rê chuột nên
  observer theo dõi cả thuộc tính `href`.
- **Chỉ gửi bài trong 3 ngày** (`MAX_POST_AGE_DAYS`, `src/lib/postTime.ts`): giờ đăng suy ra từ chữ ở link giờ
  đăng của chính bài (aria-label rồi chữ hiển thị; tiếng Việt + Anh, tương đối và ngày tuyệt đối). Chỉ có ngày thì
  coi là 23:59 để không loại nhầm. Không đọc được thì **vẫn gửi** (`posted_at` null), không đoán. `posted_at` lưu
  vào `fb_opportunities.posted_at`, CRM hiện "đăng khoảng…".
- **Chẩn đoán (`src/lib/diagnose.ts`)** che mọi nội dung/tên/id (test kiểm), để người dùng dán vào chat được.
  Facebook đổi giao diện: lấy chẩn đoán, chép cấu trúc mới vào `tests/fixtures/group-feed.html`, sửa extractor
  tới khi `npm test` qua, rồi `npm run e2e`.

## Directory layout

```
src/
  entrypoints/background.ts, facebook.content.ts, popup/{index.html,main.tsx,App.tsx,style.css}
  lib/extractor.ts, postTime.ts, diagnose.ts, messages.ts, supabase.ts
  env.d.ts
tests/extractor.test.ts, postTime.test.ts, fixtures/{group-feed,news-feed}.html, e2e/e2e.cjs
scripts/e2e-remote.sh, make-icons.mjs, icon.svg
public/icon/{16,32,48,128}.png
```

## Known gaps

- Không đọc bình luận, trang cá nhân; group nhận theo id số hoặc tên rút gọn trong link (đổi tên rút gọn thì thêm
  lại group ở CRM). Group thêm bằng tên rút gọn mà chưa mở trang group lần nào thì News Feed có thể chưa khớp.
- Bài bị "Xem thêm" cắt chỉ gửi phần đang hiện, mở rộng sau không gửi lại (server bỏ trùng theo id).
- Bài chỉ có ảnh/video bị bỏ qua phía extension.
- Lọc 3 ngày chỉ áp cho bài đọc được giờ đăng; Facebook xáo chữ giờ đăng thì bài cũ vẫn lọt (popup: "Không rõ
  giờ đăng"). Số ngày là hằng số, chưa chỉnh ở CRM.
- Fixture là cấu trúc mô phỏng, chưa đối chiếu với DOM Facebook thật: lần đầu dùng thật cần xem popup
  ("Bài đọc được", "Chưa có id bài") và lấy chẩn đoán nếu số liệu sai.
- Chỉ Chrome, cài Load unpacked; không có cập nhật tự động.
