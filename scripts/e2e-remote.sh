#!/usr/bin/env bash
# E2E trên server (Playwright trong Docker, dùng lại node_modules + image của ../demo-recorder):
# Chromium thật + extension đã build, facebook.com được thay bằng tests/fixtures/group-feed.html nên không chạm
# Facebook thật. Tạo user + group "TEST e2e" tạm trên Supabase CRM, gửi bài thật qua ingest-fb-posts (Claude chấm,
# bot cơ hội có thể nhắn Telegram), in kết quả, chụp popup về .output/e2e/, rồi xoá sạch dữ liệu tạm.
#   npm run build && npm run e2e
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
CRM=${CRM_DIR:-$HERE/../portfolio-ducdev}   # cần supabase link + .env của portfolio
OUT=$HERE/.output/e2e
[ -f "$HERE/.output/chrome-mv3/manifest.json" ] || { echo "Chưa build: npm run build" >&2; exit 1; }

cd "$CRM"
REF=$(cat supabase/.temp/project-ref)
SR=$(npx supabase projects api-keys --project-ref "$REF" -o json 2>/dev/null | python3 -c "import json,sys; print([k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'][0])")
B=https://$REF.supabase.co
EMAIL="fbtest-$(date +%s)@miniapps.io.vn"; PW="T$(openssl rand -hex 12)!"
USER_ID=$(curl -s -X POST "$B/auth/v1/admin/users" -H "apikey: $SR" -H "Authorization: Bearer $SR" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"email_confirm\":true}" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
cleanup() {
  # Group thử + group extension tự thêm trong lúc thử (id/tên rút gọn giả, chỉ có trong fixture).
  local G="name like 'TEST e2e%' or fb_group_id in ('123456789','555555555','777777777') or slug in ('caphe.khoinghiep','khong.theo.doi')"
  npx supabase db query --linked "delete from fb_opportunities where group_id in (select id from fb_watched_groups where $G); delete from fb_watched_groups where $G" >/dev/null 2>&1 || true
  curl -s -o /dev/null -w 'Đã dọn dữ liệu tạm, xoá user test: %{http_code}\n' -X DELETE "$B/auth/v1/admin/users/$USER_ID" -H "apikey: $SR" -H "Authorization: Bearer $SR"
  ssh server 'rm -rf ~/fbscout-e2e' 2>/dev/null || true
}
trap cleanup EXIT
npx supabase db query --linked "insert into fb_watched_groups (fb_group_id, slug, name) values ('123456789', null, 'TEST e2e'), (null, 'caphe.khoinghiep', 'TEST e2e slug')" >/dev/null

wake-server -q
ssh server 'mkdir -p ~/fbscout-e2e/ext'
rsync -a --delete "$HERE/.output/chrome-mv3/" server:fbscout-e2e/ext/
rsync -a "$HERE/tests/e2e/e2e.cjs" "$HERE/tests/fixtures/group-feed.html" "$HERE/tests/fixtures/news-feed.html" server:fbscout-e2e/
ssh server "docker run --rm --init --ipc=host --user \$(id -u):\$(id -g) -e HOME=/tmp -e NODE_PATH=/nm \
  -e EMAIL='$EMAIL' -e PW='$PW' -v \$HOME/fbscout-e2e:/work -v \$HOME/demo-recorder/node_modules:/nm:ro -w /work \
  demo-recorder:1.63 node e2e.cjs"
mkdir -p "$OUT" && rsync -a 'server:fbscout-e2e/*.png' "$OUT/"
echo "--- Bài đã lưu:"
npx supabase db query --linked "select g.name as nhom, o.fb_post_id, o.status, o.ai_score, o.posted_at from fb_opportunities o join fb_watched_groups g on g.id = o.group_id where g.name like 'TEST e2e%' or g.fb_group_id = '555555555' order by g.name, o.fb_post_id" 2>&1 \
  | python3 -c "import json,sys; t=sys.stdin.read(); [print(r) for r in json.loads(t[t.find('{'):])['rows']]"
echo "--- Id số học được cho group thêm bằng tên rút gọn (mong đợi 777777777):"
npx supabase db query --linked "select fb_group_id from fb_watched_groups where name = 'TEST e2e slug'" 2>&1 | grep fb_group_id || true
echo "--- Group tự thêm (mong đợi: Nhóm Không Theo Dõi, KHÔNG có khong.theo.doi):"
npx supabase db query --linked "select name, fb_group_id, slug from fb_watched_groups where fb_group_id = '555555555' or slug = 'khong.theo.doi'" 2>&1 | grep -E '"(name|fb_group_id|slug)"' || true
echo "Ảnh popup: $OUT"
