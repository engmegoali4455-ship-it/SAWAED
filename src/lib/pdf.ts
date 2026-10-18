'use client';
import { supabase } from './supabase';

/** يطلب من الخادم توليد PDF ويعيد رابطاً مؤقتاً */
export async function openPdf(kind: 'weekly_report' | 'meeting', id: string): Promise<string> {
  const { data, error } = await supabase().functions.invoke('render-pdf', { body: { kind, id } });
  if (error) throw new Error(navigator.onLine ? 'تعذّر توليد الملف' : 'توليد PDF يتطلب اتصالاً بالإنترنت');
  return data.url as string;
}
