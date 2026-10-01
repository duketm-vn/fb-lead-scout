// Tạo icon PNG cho manifest từ scripts/icon.svg (WXT tự nhận public/icon/<cỡ>.png). Chạy: npm run icons
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('public/icon', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp('scripts/icon.svg', { density: 384 }).resize(size, size).png().toFile(`public/icon/${size}.png`);
}
console.log('Đã tạo public/icon/{16,32,48,128}.png');
