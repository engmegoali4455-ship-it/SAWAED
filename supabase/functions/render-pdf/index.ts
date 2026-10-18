// يولّد PDF للتقرير الأسبوعي أو محضر الاجتماع ويحفظه في حاوية reports، ويعيد رابطاً مؤقتاً.
// الصلاحية: يُقرأ السجل بعميل المستخدم (RLS) — من لا يرى السجل لا يحصل على ملفه.
import { handle, HttpError, json, publicUrl, serviceClient, userClient } from '../_shared/http.ts';
import { meetingPdf, weeklyReportPdf } from '../_shared/pdf/templates.ts';
import type { Img } from '../_shared/pdf/doc.ts';

const fontDir = new URL('../_shared/fonts/', import.meta.url);
let fonts: { regular: Uint8Array; bold: Uint8Array } | null = null;
async function loadFonts() {
  fonts ??= {
    regular: await Deno.readFile(new URL('IBMPlexSansArabic-Regular.ttf', fontDir)),
    bold: await Deno.readFile(new URL('IBMPlexSansArabic-SemiBold.ttf', fontDir)),
  };
  return fonts;
}

function imageType(b: Uint8Array): 'png' | 'jpg' | null {
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  return null;
}

async function download(bucket: string, path: string): Promise<Img | null> {
  const { data } = await serviceClient().storage.from(bucket).download(path);
  if (!data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const type = imageType(bytes);
  return type ? { bytes, type } : null;
}

const todayRiyadh = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const fmt = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

Deno.serve(handle(async (req) => {
  const { kind, id } = await req.json().catch(() => ({}));
  if (!kind || !id) throw new HttpError(400, 'kind and id are required');
  const user = userClient(req);
  const svc = serviceClient();

  const { data: settings } = await svc.from('app_settings').select('key, value').in('key', ['company', 'branding']);
  const company = settings?.find((s) => s.key === 'company')?.value?.name ?? 'سواعد للاستشارات الهندسية';
  const logoPath = settings?.find((s) => s.key === 'branding')?.value?.logo_path;
  const logo = (logoPath ? await download('branding', logoPath) : null)
    ?? { bytes: await Deno.readFile(new URL('../_shared/assets/logo.png', import.meta.url)), type: 'png' as const };
  const base = { ...(await loadFonts()), logo: logo ? { bytes: logo.bytes, type: logo.type } : null, company };

  let bytes: Uint8Array, path: string, projectId: string;
  if (kind === 'weekly_report') {
    const { data: r } = await user.from('weekly_reports').select('*').eq('id', id).maybeSingle();
    if (!r) throw new HttpError(404, 'التقرير غير موجود أو لا تملك صلاحية عرضه');
    const approver = r.approved_by ? (await svc.from('profiles').select('full_name, email').eq('id', r.approved_by).maybeSingle()).data : null;
    const photos: Img[] = [];
    for (const p of (r.snapshot?.photos ?? []).slice(0, 12)) {
      const img = await download('photos', p.path);
      if (img) photos.push({ ...img, caption: [p.caption, fmt(p.taken_at)].filter(Boolean).join(' — ') });
    }
    bytes = await weeklyReportPdf(base, { snapshot: r.snapshot, status: r.status, notes: r.notes, approvedBy: approver?.full_name ?? approver?.email ?? null, approvedAt: r.approved_at, photos, today: todayRiyadh() });
    projectId = r.project_id;
    path = `${r.project_id}/weekly/${r.week_start}_${r.id}.pdf`;
    if (r.pdf_path !== path) await svc.from('weekly_reports').update({ pdf_path: path }).eq('id', r.id);
  } else if (kind === 'meeting') {
    const { data: m } = await user.from('meetings').select('*').eq('id', id).maybeSingle();
    if (!m) throw new HttpError(404, 'المحضر غير موجود أو لا تملك صلاحية عرضه');
    const [{ data: actions }, { data: project }, { data: ph }] = await Promise.all([
      user.from('meeting_actions').select('*').eq('meeting_id', id).order('created_at'),
      user.from('projects').select('*').eq('id', m.project_id).single(),
      user.from('photos').select('storage_path, caption, taken_at').eq('entity_type', 'meeting').eq('entity_id', id).limit(9),
    ]);
    const photos: Img[] = [];
    for (const p of ph ?? []) { const img = await download('photos', p.storage_path); if (img) photos.push({ ...img, caption: p.caption ?? fmt(p.taken_at) }); }
    bytes = await meetingPdf(base, { meeting: m, actions: actions ?? [], project, photos });
    projectId = m.project_id;
    path = `${m.project_id}/meetings/${m.meeting_date}_${m.id}.pdf`;
  } else throw new HttpError(400, 'unknown kind');

  const { error } = await svc.storage.from('reports').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  const { data: signed, error: e2 } = await svc.storage.from('reports').createSignedUrl(path, 600, { download: false });
  if (e2 || !signed) throw e2 ?? new Error('sign failed');
  return json({ url: publicUrl(signed.signedUrl), path, project_id: projectId });
}));
