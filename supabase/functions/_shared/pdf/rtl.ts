// نص عربي في PDF: خوارزمية Unicode Bidi تقسم السطر إلى مقاطع بترتيبها المرئي،
// ثم يشكّل fontkit كل مقطع (وصل الحروف) ويعكس المقاطع العربية تلقائياً.
// يعمل في Deno (Edge Functions) و Node (الاختبارات) بنفس الكود.
import bidiFactory from 'bidi-js';
import type { PDFFont } from 'pdf-lib';

const bidi = bidiFactory();
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' };
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

export interface Run { text: string; rtl: boolean }

/** يقسم سطراً منطقياً إلى مقاطع بالترتيب المرئي (من اليسار إلى اليمين) */
export function visualRuns(line: string, baseRtl = true): Run[] {
  if (!line) return [];
  const levels = bidi.getEmbeddingLevels(line, baseRtl ? 'rtl' : 'ltr');
  const chars = line.split(''); // فهارس UTF-16 كما تُرجعها bidi-js
  const mirroredChars = chars.map((c, i) => (levels.levels[i] % 2 === 1 && MIRROR[c]) || c);
  // ترتيب مرئي للفهارس
  const order = chars.map((_, i) => i);
  for (const [start, end] of bidi.getReorderSegments(line, levels)) {
    const seg = order.slice(start, end + 1).reverse();
    order.splice(start, seg.length, ...seg);
  }
  const lv = levels.levels;
  // تجميع الفهارس المتتالية بنفس المستوى في مقاطع
  const runs: Run[] = [];
  let i = 0;
  while (i < order.length) {
    const level = lv[order[i]];
    const rtl = level % 2 === 1;
    let j = i + 1;
    while (j < order.length && lv[order[j]] === level && order[j] === order[j - 1] + (rtl ? -1 : 1)) j++;
    const idx = order.slice(i, j);
    const lo = Math.min(...idx), hi = Math.max(...idx);
    // نمرّر النص بترتيبه المنطقي؛ fontkit يشكّل المقطع العربي ويعكس ترتيبه لكنه لا يقلب الأقواس،
    // لذا نقلبها نحن. مقطع RTL بلا حروف عربية (رموز فقط) نعكسه بأنفسنا.
    let text = (rtl ? mirroredChars : chars).slice(lo, hi + 1).join('');
    if (rtl && !ARABIC.test(text)) text = [...text].reverse().join('');
    runs.push({ text, rtl });
    i = j;
  }
  return runs;
}

export function textWidth(text: string, font: PDFFont, size: number): number {
  return visualRuns(text).reduce((w, r) => w + font.widthOfTextAtSize(r.text, size), 0);
}

/** يلف النص على عرض محدد (بالكلمات، مع احترام أسطر \n) */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (textWidth(next, font, size) <= width || !line) line = next;
      else { out.push(line); line = w; }
      // كلمة واحدة أطول من السطر: تُقسم بالأحرف
      while (textWidth(line, font, size) > width && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && textWidth(line.slice(0, k), font, size) > width) k--;
        out.push(line.slice(0, k)); line = line.slice(k);
      }
    }
    out.push(line);
  }
  return out;
}
