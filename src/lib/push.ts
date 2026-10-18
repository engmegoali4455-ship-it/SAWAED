'use client';
// تسجيل الجهاز لاستقبال الإشعارات: Web Push في المتصفح، و FCM/APNs داخل تطبيق الجوال.
import { supabase } from './supabase';

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function b64ToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported(): boolean {
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  return 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID;
}

async function save(platform: 'web' | 'fcm' | 'apns', endpoint: string, keys: any) {
  const { data: u } = await supabase().auth.getUser();
  if (!u.user) throw new Error('سجّل الدخول أولاً');
  const { error } = await supabase().from('push_subscriptions').upsert({ user_id: u.user.id, platform, endpoint, keys }, { onConflict: 'user_id,endpoint' });
  if (error) throw error;
}

export async function enablePush(): Promise<string> {
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') throw new Error('لم يُسمح بالإشعارات');
    const token = await new Promise<string>((res, rej) => {
      PushNotifications.addListener('registration', (t) => res(t.value));
      PushNotifications.addListener('registrationError', (e) => rej(new Error(e.error)));
      PushNotifications.register();
    });
    await save(cap.getPlatform() === 'ios' ? 'apns' : 'fcm', token, null);
    return 'فُعّلت الإشعارات على هذا الجهاز';
  }
  if (!pushSupported()) throw new Error('المتصفح لا يدعم الإشعارات، أو لم تُضبط مفاتيح VAPID');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('لم يُسمح بالإشعارات');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID) }));
  const json = sub.toJSON();
  await save('web', json.endpoint!, json.keys);
  return 'فُعّلت الإشعارات في هذا المتصفح';
}
