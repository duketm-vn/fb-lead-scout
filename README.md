# FB Lead Scout

Chrome extension đọc **thụ động** bài từ các Facebook Group bạn theo dõi, cả trong trang group lẫn trên News Feed, gửi lên CRM (taminhduc.com) để Claude
chấm xem có phải người cần làm app/web không. Cơ hội tốt được báo qua bot Telegram riêng, duyệt ở
**CRM → Cơ hội FB** và chuyển thành lead.

Extension **không** tự cuộn, không tự bấm, không mở tab và không chạy ngầm trên Facebook. Nó chỉ đọc những bài đã
hiện trên màn hình khi chính bạn mở và cuộn group, để hạn chế rủi ro tài khoản Facebook bị khoá.

## Cài đặt (1 lần)

1. Cài thư viện và tạo file cấu hình:
   ```bash
   npm install
   cp .env.example .env   # điền WXT_SUPABASE_URL + WXT_SUPABASE_ANON_KEY của Supabase CRM
   npm run build
   ```
2. Mở Chrome, vào `chrome://extensions`, bật **Developer mode** (góc phải trên).
3. Bấm **Load unpacked**, chọn thư mục `.output/chrome-mv3`. Trên WSL, đường dẫn từ Windows là
   `\\wsl.localhost\Ubuntu-26.04\home\duc-dev\workspace\fb-lead-scout\.output\chrome-mv3`.
4. Ghim extension lên thanh công cụ (biểu tượng mảnh ghép → ghim **FB Lead Scout**).
5. Bấm vào biểu tượng, đăng nhập bằng tài khoản admin CRM.

Cập nhật bản mới: `git pull && npm run build`, rồi bấm nút tải lại (↻) của extension ở `chrome://extensions` và
tải lại các tab Facebook đang mở.

## Dùng hằng ngày

1. Mặc định extension **tự theo dõi mọi group gặp được**: lướt trang **Nhóm** (`facebook.com/groups/feed/`) hoặc News
   Feed, gặp bài từ group chưa có trong CRM thì tự thêm group rồi đọc. Group toàn bài không liên quan thì vào
   **CRM → Cơ hội FB → Group theo dõi** bỏ tick "Theo dõi" (không bị tự thêm lại). Tắt chế độ này ở popup nếu chỉ
   muốn đọc các group tự thêm tay (dán link group ở cùng màn đó).
2. Lướt **News Feed** hoặc mở trang group như bình thường. Trên News Feed, extension chỉ đọc bài từ group đang theo
   dõi (bài bạn bè, trang, quảng cáo, group khác bị bỏ qua). Popup hiện số bài đọc được.
   Group thêm bằng link tên rút gọn: mở trang group đó 1 lần để extension ghi nhận id số (News Feed hay dùng id số).
   Bài đăng **cũ hơn 3 ngày** bị bỏ qua (gần như hết cơ hội, đỡ phí chấm điểm).
3. Cơ hội từ ngưỡng điểm trở lên (mặc định 70) được bot Telegram báo ngay. Tất cả cơ hội nằm ở **CRM → Cơ hội FB**.

Popup báo group **chưa có trong danh sách theo dõi** nghĩa là extension không đọc gì ở group đó.

## Giới hạn đã biết

- Đọc ở News Feed, trang "Nhóm" tổng hợp và trang group; không đọc bình luận, trang cá nhân, Marketplace.
- Group thêm bằng tên rút gọn mà chưa từng mở trang group: bài của group đó trên News Feed có thể chưa được nhận.
- Bài dài bị cắt bởi "Xem thêm" chỉ gửi phần đang hiện (extension không tự bấm). Bấm "Xem thêm" sau đó cũng
  không gửi lại vì bài đã được chấm.
- Bài chỉ có ảnh/video (không có chữ) bị bỏ qua.
- Tuổi bài suy ra từ chữ ở giờ đăng ("2 giờ", "Hôm qua", "28 tháng 9"...). Bài không đọc được giờ đăng vẫn được
  gửi để không sót; popup đếm riêng ở dòng "Không rõ giờ đăng". Nếu dòng này gần bằng "Bài đọc được" thì Facebook
  đang xáo chữ ở chỗ giờ đăng, hãy gửi chẩn đoán.
- Facebook đôi khi ẩn link bài cho tới khi rê chuột vào giờ đăng; bài đó được đọc khi link hiện ra.
- Facebook đổi giao diện thì phần đọc bài có thể hỏng. Popup sẽ báo "Bài đọc được: 0" dù đang có bài. Khi đó bấm
  **Sao chép chẩn đoán** (chỉ chứa cấu trúc trang, không chứa nội dung hay tên) và gửi để sửa `src/lib/extractor.ts`.
- Mỗi bài gửi đi tốn phí Claude API (khoảng 2 USD/tháng nếu đọc khoảng 100 bài/ngày). Tự theo dõi mọi group làm
  số bài tăng theo mức bạn lướt; xem Usage ở console.anthropic.com và tắt bớt group ồn ở CRM.
- Extension không tự cuộn: lướt trang Nhóm càng xa thì đọc được càng nhiều.
