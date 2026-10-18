'use client';
import { useEffect, type ReactNode } from 'react';
import { SessionProvider } from '@/lib/session';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Service Worker للعمل دون اتصال (لا يُسجَّل داخل Capacitor: الملفات محلية أصلاً)
    const native = (window as any).Capacitor?.isNativePlatform?.();
    if ('serviceWorker' in navigator && !native && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    // طلب تخزين دائم كي لا يمسح المتصفح بيانات الموقع غير المتزامنة
    navigator.storage?.persist?.();
  }, []);
  return <SessionProvider>{children}</SessionProvider>;
}
