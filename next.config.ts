import type { NextConfig } from 'next';

// تصدير ثابت: نفس الملفات تُنشر كـ PWA وتُغلَّف في Capacitor و Tauri
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};
export default config;
