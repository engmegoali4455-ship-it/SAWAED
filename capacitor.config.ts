import type { CapacitorConfig } from '@capacitor/cli';

// نفس ملفات out/ تُغلَّف كتطبيق Android و iOS
const config: CapacitorConfig = {
  appId: 'sa.sawaed.supervision',
  appName: 'سواعد للإشراف',
  webDir: 'out',
  backgroundColor: '#f1eee9',
  android: { allowMixedContent: false },
  ios: { contentInset: 'automatic', backgroundColor: '#f1eee9' },
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};
export default config;
