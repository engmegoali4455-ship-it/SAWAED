// إرسال الإشعارات: Web Push (VAPID)، و FCM HTTP v1 (أندرويد)، و APNs (iOS).
// كل قناة تُفعَّل فقط إن ضُبطت أسرارها؛ وإلا تُتجاوز دون خطأ.
import webpush from 'web-push';
import { env } from './http.ts';

export interface PushMsg { title: string; body: string; url: string; tag?: string }
export interface Sub { id: string; platform: 'web' | 'fcm' | 'apns'; endpoint: string; keys: any }
export type Result = 'sent' | 'gone' | 'skipped' | 'failed';

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = new TextEncoder();

function pemToDer(pem: string): ArrayBuffer {
  const b = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer;
}
async function signJwt(header: object, claims: object, key: CryptoKey, alg: 'RS256' | 'ES256') {
  const data = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(claims)))}`;
  const sig = await crypto.subtle.sign(alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(data));
  return `${data}.${b64url(sig)}`;
}

// --- Web Push ---
let vapidReady = false;
async function sendWeb(s: Sub, m: PushMsg): Promise<Result> {
  if (!env('VAPID_PRIVATE_KEY')) return 'skipped';
  if (!vapidReady) { webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:it@sawaed.sa', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY')); vapidReady = true; }
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(m), { TTL: 86400, urgency: 'high' });
    return 'sent';
  } catch (e: any) {
    return e?.statusCode === 404 || e?.statusCode === 410 ? 'gone' : 'failed';
  }
}

// --- FCM HTTP v1 ---
let fcmToken: { token: string; exp: number } | null = null;
async function fcmAccessToken(sa: any) {
  if (fcmToken && fcmToken.exp > Date.now() + 60_000) return fcmToken.token;
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwt({ alg: 'RS256', typ: 'JWT' }, { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }, key, 'RS256');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}` });
  const j = await r.json();
  if (!j.access_token) throw new Error('FCM auth failed');
  fcmToken = { token: j.access_token, exp: Date.now() + 3500_000 };
  return fcmToken.token;
}
async function sendFcm(s: Sub, m: PushMsg): Promise<Result> {
  const raw = env('FCM_SERVICE_ACCOUNT');
  if (!raw) return 'skipped';
  const sa = JSON.parse(raw);
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST', headers: { Authorization: `Bearer ${await fcmAccessToken(sa)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token: s.endpoint, notification: { title: m.title, body: m.body }, data: { url: m.url }, android: { priority: 'high' } } }),
  });
  if (r.ok) return 'sent';
  const t = await r.text();
  return r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(t) ? 'gone' : 'failed';
}

// --- APNs ---
let apnsJwt: { token: string; exp: number } | null = null;
async function sendApns(s: Sub, m: PushMsg): Promise<Result> {
  const p8 = env('APNS_PRIVATE_KEY');
  if (!p8) return 'skipped';
  if (!apnsJwt || apnsJwt.exp < Date.now()) {
    const key = await crypto.subtle.importKey('pkcs8', pemToDer(p8), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    apnsJwt = { token: await signJwt({ alg: 'ES256', kid: env('APNS_KEY_ID') }, { iss: env('APNS_TEAM_ID'), iat: Math.floor(Date.now() / 1000) }, key, 'ES256'), exp: Date.now() + 50 * 60_000 };
  }
  const host = env('APNS_PRODUCTION') === 'true' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
  const r = await fetch(`https://${host}/3/device/${s.endpoint}`, {
    method: 'POST',
    headers: { authorization: `bearer ${apnsJwt.token}`, 'apns-topic': env('APNS_BUNDLE_ID') || 'sa.sawaed.supervision', 'apns-push-type': 'alert', 'apns-priority': '10' },
    body: JSON.stringify({ aps: { alert: { title: m.title, body: m.body }, sound: 'default' }, url: m.url }),
  });
  if (r.ok) return 'sent';
  return r.status === 410 || r.status === 400 ? 'gone' : 'failed';
}

export function send(s: Sub, m: PushMsg): Promise<Result> {
  return s.platform === 'web' ? sendWeb(s, m) : s.platform === 'fcm' ? sendFcm(s, m) : sendApns(s, m);
}
