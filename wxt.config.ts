import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// Chỉ build cho Chrome (MV3), cài bằng chế độ developer, không đưa lên Chrome Web Store.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'FB Lead Scout',
    description: 'Đọc thụ động bài trong Facebook Group đang mở, gửi lên CRM để chấm cơ hội làm app/web.',
    permissions: ['storage', 'alarms'],
    host_permissions: ['https://*.supabase.co/*'],
  },
});
