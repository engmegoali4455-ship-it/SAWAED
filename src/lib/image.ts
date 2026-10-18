'use client';
// الصور: تُضغط قبل الرفع (أقصى بُعد 1600px)، ويُقرأ وقت الالتقاط والإحداثيات
// من بيانات EXIF، وإلا فمن موقع الجهاز الحالي ووقت الإضافة.
import { db } from './db';
import { supabase } from './supabase';

export const MAX_DIM = 1600;
export const MAX_PHOTOS = 20;

export interface PreparedPhoto {
  key: string;
  blob: Blob;
  preview: string;
  taken_at: string;
  lat: number | null;
  lng: number | null;
  phase?: 'general' | 'before' | 'after';
}

export function fitWithin(w: number, h: number, max = MAX_DIM): { w: number; h: number } {
  if (w <= max && h <= max) return { w, h };
  const r = Math.min(max / w, max / h);
  return { w: Math.round(w * r), h: Math.round(h * r) };
}

export async function compressImage(file: Blob, max = MAX_DIM, quality = 0.82): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const { w, h } = fitWithin(bmp.width, bmp.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('تعذّر ضغط الصورة'))), 'image/jpeg', quality));
}

let lastFix: { lat: number; lng: number; at: number } | null = null;
export function currentPosition(timeout = 8000): Promise<{ lat: number; lng: number } | null> {
  if (lastFix && Date.now() - lastFix.at < 120_000) return Promise.resolve(lastFix);
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      (p) => { lastFix = { lat: p.coords.latitude, lng: p.coords.longitude, at: Date.now() }; res(lastFix); },
      () => res(null),
      { enableHighAccuracy: true, timeout, maximumAge: 60_000 },
    );
  });
}

export async function preparePhotos(files: FileList | File[], phase: PreparedPhoto['phase'] = 'general'): Promise<PreparedPhoto[]> {
  const exifr = (await import('exifr')).default;
  const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
  const out: PreparedPhoto[] = [];
  let fallback: { lat: number; lng: number } | null | undefined;
  for (const f of list) {
    let meta: any = null;
    try { meta = await exifr.parse(f, { gps: true, pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'] }); } catch { /* صورة بلا EXIF */ }
    let lat = typeof meta?.latitude === 'number' ? meta.latitude : null;
    let lng = typeof meta?.longitude === 'number' ? meta.longitude : null;
    if (lat === null) {
      if (fallback === undefined) fallback = await currentPosition();
      lat = fallback?.lat ?? null; lng = fallback?.lng ?? null;
    }
    const when: Date | undefined = meta?.DateTimeOriginal ?? meta?.CreateDate;
    const blob = await compressImage(f);
    out.push({ key: `${f.name}-${f.size}-${Math.random()}`, blob, preview: URL.createObjectURL(blob),
      taken_at: (when instanceof Date && !Number.isNaN(+when) ? when : new Date()).toISOString(), lat, lng, phase });
  }
  return out;
}

// روابط مؤقتة للصور المرفوعة (أو النسخة المحلية إن لم تُرفع بعد)
const urlCache = new Map<string, { url: string; exp: number }>();
export async function photoUrl(photoId: string, path: string, bucket = 'photos'): Promise<string | null> {
  const local = await db.blobs.get(photoId);
  if (local) return URL.createObjectURL(local.blob);
  const c = urlCache.get(path);
  if (c && c.exp > Date.now()) return c.url;
  const { data } = await supabase().storage.from(bucket).createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 3300_000 });
  return data.signedUrl;
}
