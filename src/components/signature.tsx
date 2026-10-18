'use client';
import { useEffect, useRef, useState } from 'react';
import { Btn } from './ui';

/** لوحة توقيع رقمي: تُرجع PNG */
export function SignaturePad({ onChange }: { onChange: (b: Blob | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = 160 * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#221f1d';
  }, []);

  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  return (
    <div className="space-y-2">
      <canvas ref={ref} className="h-40 w-full touch-none rounded-md border border-dashed border-ink-soft bg-white" aria-label="مساحة التوقيع"
        onPointerDown={(e) => { drawing.current = true; const [x, y] = pos(e); const ctx = ref.current!.getContext('2d')!; ctx.beginPath(); ctx.moveTo(x, y); ref.current!.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drawing.current) return; const [x, y] = pos(e); const ctx = ref.current!.getContext('2d')!; ctx.lineTo(x, y); ctx.stroke(); setDirty(true); }}
        onPointerUp={() => { drawing.current = false; ref.current!.toBlob((b) => onChange(b), 'image/png'); }} />
      <div className="flex gap-2">
        <Btn type="button" size="sm" variant="ghost" onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setDirty(false); onChange(null); }}>مسح التوقيع</Btn>
      </div>
    </div>
  );
}
