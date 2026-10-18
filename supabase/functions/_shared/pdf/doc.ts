// مُنشئ مستندات PDF عربية بهوية سواعد: ترويسة بالشعار، ترقيم صفحات، أقسام،
// جداول تلتف خلاياها وتتكرر رؤوسها، وشبكة صور.
import './proto-shim.ts';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { textWidth, visualRuns, wrap } from './rtl.ts';

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
export const C = { ink: hex('#231f1c'), soft: hex('#726a62'), line: hex('#e0dad2'), paper: hex('#f1eee9'), brand: hex('#e85e30'), brandText: hex('#c94a22'), head: hex('#221f1d'), white: rgb(1, 1, 1), red: hex('#b23b2c'), green: hex('#3f7a52') };

const A4: [number, number] = [595.28, 841.89];
const M = 36;              // الهامش
const HEADER = 74;         // ارتفاع الترويسة
const FOOTER = 34;

export interface DocOptions {
  regular: Uint8Array; bold: Uint8Array;
  logo?: { bytes: Uint8Array; type: 'png' | 'jpg' } | null;
  company: string; title: string; subtitle?: string; generatedAt?: Date;
}
export interface Img { bytes: Uint8Array; type: 'png' | 'jpg'; caption?: string }

export class ArabicPdf {
  private doc!: PDFDocument;
  private font!: PDFFont;
  private bold!: PDFFont;
  private logo: PDFImage | null = null;
  private page!: PDFPage;
  private y = 0;
  private opts!: DocOptions;
  readonly width = A4[0] - 2 * M;
  get right() { return A4[0] - M; }

  static async create(opts: DocOptions) {
    const d = new ArabicPdf();
    d.opts = opts;
    d.doc = await PDFDocument.create();
    d.doc.registerFontkit(fontkit);
    // دون subset: التقسيم الجزئي في pdf-lib يُسقط أشكال الحروف العربية الموصولة.
    // calt معطّل: بدائله السياقية (.short) تحتاج إزاحات GPOS لا يطبّقها pdf-lib فتظهر فجوات.
    const embed = { subset: false, features: { calt: false } } as any;
    d.font = await d.doc.embedFont(opts.regular, embed);
    d.bold = await d.doc.embedFont(opts.bold, embed);
    if (opts.logo) {
      try { d.logo = opts.logo.type === 'png' ? await d.doc.embedPng(opts.logo.bytes) : await d.doc.embedJpg(opts.logo.bytes); } catch { d.logo = null; }
    }
    d.doc.setTitle(opts.title); d.doc.setAuthor(opts.company); d.doc.setCreator('سواعد للإشراف الهندسي'); d.doc.setLanguage('ar-SA');
    d.newPage();
    return d;
  }

  private newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - HEADER - 18;
  }
  /** يضمن مساحة رأسية، وإلا يبدأ صفحة جديدة */
  ensure(h: number) { if (this.y - h < FOOTER + 10) this.newPage(); }

  /** يرسم سطراً واحداً. align: right (افتراضي) | left | center */
  line(text: string, xRight: number, y: number, o: { size?: number; bold?: boolean; color?: RGB; align?: 'right' | 'left' | 'center'; page?: PDFPage } = {}) {
    const size = o.size ?? 10, font = o.bold ? this.bold : this.font;
    const w = textWidth(text, font, size);
    let x = o.align === 'left' ? xRight : o.align === 'center' ? xRight - w / 2 : xRight - w;
    for (const r of visualRuns(text)) {
      (o.page ?? this.page).drawText(r.text, { x, y, size, font, color: o.color ?? C.ink });
      x += font.widthOfTextAtSize(r.text, size);
    }
    return w;
  }

  heading(text: string) {
    this.ensure(34);
    this.y -= 8;
    this.page.drawRectangle({ x: this.right - 4, y: this.y - 3, width: 4, height: 16, color: C.brand });
    this.line(text, this.right - 10, this.y, { size: 13, bold: true, color: C.brandText });
    this.y -= 14;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: this.right, y: this.y }, thickness: 0.5, color: C.line });
    this.y -= 12;
  }

  paragraph(text: string | null | undefined, o: { size?: number; bold?: boolean; color?: RGB; label?: string } = {}) {
    if (!text && !o.label) return;
    const size = o.size ?? 10;
    const lh = size * 1.7;
    if (o.label) { this.ensure(lh * 2); this.line(o.label, this.right, this.y, { size, bold: true }); this.y -= lh; }
    for (const l of wrap(text || '—', this.font, size, this.width)) {
      this.ensure(lh);
      this.line(l, this.right, this.y, { size, bold: o.bold, color: o.color });
      this.y -= lh;
    }
    this.y -= 4;
  }

  /** شبكة "عنوان: قيمة" */
  kv(pairs: [string, string | null | undefined][], cols = 4) {
    const cw = this.width / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      const chunk = pairs.slice(i, i + cols);
      const vals = chunk.map(([k, v]) => (k ? wrap(v || '—', this.bold, 10, cw - 8).slice(0, 2) : []));
      const h = 22 + Math.max(1, ...vals.map((v) => v.length)) * 14;
      this.ensure(h);
      chunk.forEach(([k], j) => {
        if (!k) return;
        const xr = this.right - j * cw;
        this.line(k, xr, this.y, { size: 8, color: C.soft });
        vals[j].forEach((l, n) => this.line(l, xr, this.y - 14 - n * 14, { size: 10, bold: true }));
      });
      this.y -= h;
    }
    this.y -= 4;
  }

  /** جدول: الأعمدة من اليمين لليسار، الخلايا تلتف، والرأس يتكرر في الصفحة الجديدة */
  table(headers: string[], rows: (string | null | undefined)[][], widths?: number[]) {
    if (!rows.length) { this.paragraph('لا يوجد', { color: C.soft }); return; }
    const total = (widths ?? headers.map(() => 1)).reduce((a, b) => a + b, 0);
    const cw = (widths ?? headers.map(() => 1)).map((w) => (w / total) * this.width);
    const pad = 5, size = 9, lh = 13;
    const drawHeader = () => {
      this.ensure(24);
      this.page.drawRectangle({ x: M, y: this.y - 20, width: this.width, height: 20, color: C.paper });
      let xr = this.right;
      headers.forEach((h, i) => { this.line(h, xr - pad, this.y - 14, { size: 8.5, bold: true }); xr -= cw[i]; });
      this.y -= 20;
    };
    drawHeader();
    for (const r of rows) {
      const cells = r.map((c, i) => wrap(String(c ?? '—'), this.font, size, cw[i] - 2 * pad));
      const h = Math.max(...cells.map((c) => c.length)) * lh + 8;
      if (this.y - h < FOOTER + 10) { this.newPage(); drawHeader(); }
      let xr = this.right;
      cells.forEach((lines, i) => {
        lines.forEach((l, k) => this.line(l, xr - pad, this.y - 14 - k * lh, { size }));
        xr -= cw[i];
      });
      this.y -= h;
      this.page.drawLine({ start: { x: M, y: this.y }, end: { x: this.right, y: this.y }, thickness: 0.4, color: C.line });
    }
    this.y -= 8;
  }

  /** شبكة صور (3 في الصف) مع تعليق */
  async photos(images: Img[], perRow = 3) {
    const gap = 8, w = (this.width - gap * (perRow - 1)) / perRow, h = w * 0.75;
    for (let i = 0; i < images.length; i += perRow) {
      this.ensure(h + 26);
      for (const [j, im] of images.slice(i, i + perRow).entries()) {
        let pdfImg: PDFImage;
        try { pdfImg = im.type === 'png' ? await this.doc.embedPng(im.bytes) : await this.doc.embedJpg(im.bytes); } catch { continue; }
        const s = Math.min(w / pdfImg.width, h / pdfImg.height);
        const iw = pdfImg.width * s, ih = pdfImg.height * s;
        const xr = this.right - j * (w + gap);
        this.page.drawRectangle({ x: xr - w, y: this.y - h, width: w, height: h, color: C.paper });
        this.page.drawImage(pdfImg, { x: xr - w + (w - iw) / 2, y: this.y - h + (h - ih) / 2, width: iw, height: ih });
        if (im.caption) this.line(wrap(im.caption, this.font, 7.5, w)[0], xr, this.y - h - 11, { size: 7.5, color: C.soft });
      }
      this.y -= h + 22;
    }
  }

  async signature(img: Img | null, label: string, name?: string | null) {
    this.ensure(90);
    this.line(label, this.right, this.y, { size: 9, color: C.soft });
    if (img) {
      try {
        const p = img.type === 'png' ? await this.doc.embedPng(img.bytes) : await this.doc.embedJpg(img.bytes);
        const s = Math.min(160 / p.width, 60 / p.height);
        this.page.drawImage(p, { x: this.right - p.width * s, y: this.y - 66, width: p.width * s, height: p.height * s });
      } catch { /* توقيع تالف */ }
    }
    if (name) this.line(name, this.right, this.y - 80, { size: 9, bold: true });
    this.y -= 92;
  }

  space(h: number) { this.y -= h; }

  /** يضيف الترويسة والتذييل لكل الصفحات ويعيد الملف */
  async finish(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    const when = this.opts.generatedAt ?? new Date();
    const stamp = `${String(when.getDate()).padStart(2, '0')}/${String(when.getMonth() + 1).padStart(2, '0')}/${when.getFullYear()}`;
    pages.forEach((p, i) => {
      const [W, H] = [A4[0], A4[1]];
      p.drawRectangle({ x: 0, y: H - HEADER, width: W, height: HEADER, color: C.head });
      p.drawRectangle({ x: 0, y: H - HEADER - 3, width: W, height: 3, color: C.brand });
      let xr = W - M;
      if (this.logo) {
        const s = Math.min(46 / this.logo.width, 46 / this.logo.height);
        p.drawRectangle({ x: xr - 50, y: H - HEADER + 12, width: 50, height: 50, color: C.white });
        p.drawImage(this.logo, { x: xr - 48 + (46 - this.logo.width * s) / 2, y: H - HEADER + 14 + (46 - this.logo.height * s) / 2, width: this.logo.width * s, height: this.logo.height * s });
        xr -= 62;
      }
      this.line(this.opts.company, xr, H - 30, { size: 10, color: hex('#c9beb5'), page: p });
      this.line(this.opts.title, xr, H - 50, { size: 15, bold: true, color: C.white, page: p });
      if (this.opts.subtitle) this.line(this.opts.subtitle, M, H - 50, { size: 9, color: hex('#c9beb5'), align: 'left', page: p });
      p.drawLine({ start: { x: M, y: FOOTER }, end: { x: W - M, y: FOOTER }, thickness: 0.5, color: C.line });
      this.line(`صفحة ${i + 1} من ${pages.length}`, W - M, FOOTER - 14, { size: 8, color: C.soft, page: p });
      this.line(`سواعد للإشراف الهندسي · ${stamp}`, M, FOOTER - 14, { size: 8, color: C.soft, align: 'left', page: p });
    });
    return this.doc.save();
  }
}
