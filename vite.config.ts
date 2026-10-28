import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev only: proxies /api to `npm run dev:api` (wrangler on :8787).
// Never deployed — production serves one worker (assets + API).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
});
