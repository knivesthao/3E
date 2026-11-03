import type { CapacitorConfig } from '@capacitor/cli';

// Funded-day release flow (no code changes needed):
//   VITE_API_URL=https://<prod-worker> npm run build && npx cap sync
//   then open android/ in Android Studio or ios/ in Xcode to sign + submit.
// Web builds leave VITE_API_URL empty and stay same-origin (see src/lib/api.ts).
const config: CapacitorConfig = {
  appId: 'co.threee.reader',
  appName: '3E',
  webDir: 'dist'
};

export default config;
