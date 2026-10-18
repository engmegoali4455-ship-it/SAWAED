// استيراد ملف تصدير المنصة الحالية إلى قاعدة البيانات الجديدة.
//
//   SUPABASE_DB_URL=postgres://... npm run import -- export.json [--dry-run] [--normalize-weights]
//   (اختياري لرفع الصور) SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=...
//
// كل الإدراج في معاملة واحدة: إما يُستورد كل شيء أو لا شيء. إعادة التشغيل آمنة
// (upsert على المعرّف). يطبع تقريراً بالأعداد والسجلات المرفوضة وأسبابها،
// ويحفظه في import-report.json.
import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { mapExport, normalizeWeights, TABLE_ORDER, type Row } from './import/mapping';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const normalize = args.includes('--normalize-weights');
if (!file) { console.error('الاستخدام: npm run import -- <export.json> [--dry-run] [--normalize-weights]'); process.exit(2); }

const data = JSON.parse(readFileSync(file, 'utf8'));
const mapped = mapExport(data);
const weightTotal = mapped.tables.stages.reduce((a, s) => a + Number(s.weight), 0);
if (mapped.tables.stages.length && Math.abs(weightTotal - 100) > 0.001) {
  if (!normalize) {
    printReport({});
    console.error(`\n✖ أُوقف الاستيراد: مجموع أوزان المراحل ${weightTotal}. صحّح الملف أو أضف --normalize-weights`);
    process.exit(1);
  }
  normalizeWeights(mapped.tables.stages);
  mapped.warnings.push(`أُعيد توزيع أوزان المراحل نسبياً من ${weightTotal} إلى 100`);
}

function printReport(counts: Record<string, number>) {
  console.log('\n══ تقرير الاستيراد ══');
  for (const t of TABLE_ORDER) console.log(`  ${t.padEnd(16)} ${String(counts[t] ?? mapped.tables[t].length).padStart(5)}${dryRun ? ' (تجربة)' : ''}`);
  if (counts.photos !== undefined) console.log(`  ${'photos'.padEnd(16)} ${String(counts.photos).padStart(5)}`);
  console.log(`\n  مرفوض: ${mapped.rejected.length}`);
  for (const r of mapped.rejected) console.log(`   ✖ ${r.key}[${r.index}]${r.id ? ` (${r.id})` : ''}: ${r.reason}`);
  if (mapped.warnings.length) { console.log(`\n  تنبيهات: ${mapped.warnings.length}`); for (const w of mapped.warnings) console.log(`   ! ${w}`); }
  writeFileSync('import-report.json', JSON.stringify({ counts, rejected: mapped.rejected, warnings: mapped.warnings }, null, 2));
}

async function upsert(tx: postgres.TransactionSql, table: string, rows: Row[]) {
  if (!rows.length) return 0;
  const clean = rows.map((r) => {
    const o: Row = {};
    for (const [k, v] of Object.entries(r)) if (k === '_email') o.email = v; else o[k] = v;
    return o;
  });
  const cols = [...new Set(clean.flatMap((r) => Object.keys(r)))];
  const full = clean.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
  const [{ has_version }] = await tx`select exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = ${table} and column_name = 'version') as has_version`;
  // version = القيمة الحالية: يمر عبر فحص التعارض ويزيد الإصدار
  const updates = [...cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`),
    ...(has_version ? [`version = public.${table}.version`] : [])].join(', ');
  for (let i = 0; i < full.length; i += 500) {
    const chunk = full.slice(i, i + 500);
    await tx.unsafe(
      `insert into public.${table} (${cols.join(', ')})
       select ${cols.map((c) => `x.${c}`).join(', ')} from json_populate_recordset(null::public.${table}, $1::json) x
       on conflict (id) do update set ${updates}`,
      [tx.json(chunk as postgres.JSONValue)],
    );
  }
  return rows.length;
}

async function uploadPhotos(sql: postgres.Sql): Promise<number> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!mapped.photos.length) return 0;
  if (!url || !key) { mapped.warnings.push(`${mapped.photos.length} صورة لم تُرفع: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY غير مضبوطين`); return 0; }
  let n = 0;
  for (const [i, p] of mapped.photos.entries()) {
    try {
      let bytes: Uint8Array, type: string;
      const m = p.source.match(/^data:([^;]+);base64,(.*)$/s);
      if (m) { type = m[1]; bytes = Buffer.from(m[2], 'base64'); }
      else { const r = await fetch(p.source); if (!r.ok) throw new Error(`HTTP ${r.status}`); type = r.headers.get('content-type') ?? 'image/jpeg'; bytes = new Uint8Array(await r.arrayBuffer()); }
      const ext = type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
      const id = `imp-${p.entity_id}-${i}`;
      const path = `${p.project_id}/${p.entity_type}/${p.entity_id}/${id}.${ext}`;
      const up = await fetch(`${url}/storage/v1/object/photos/${path}`, {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': type, 'x-upsert': 'true' }, body: bytes as BodyInit });
      if (!up.ok) throw new Error(`رفع ${up.status}: ${await up.text()}`);
      await sql`insert into public.photos ${sql({ id, project_id: p.project_id, entity_type: p.entity_type, entity_id: p.entity_id,
        storage_path: path, taken_at: p.taken_at ?? null, lat: p.lat ?? null, lng: p.lng ?? null, selected_for_report: true })}
        on conflict (id) do nothing`;
      n++;
    } catch (e) {
      mapped.rejected.push({ key: `${p.table}.photos`, index: i, id: p.entity_id, reason: `صورة: ${(e as Error).message}` });
    }
  }
  return n;
}

async function main() {
  if (dryRun) { printReport({}); return; }
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) { console.error('SUPABASE_DB_URL غير مضبوط'); process.exit(2); }
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  const counts: Record<string, number> = {};
  try {
    await sql.begin(async (tx) => {
      for (const t of TABLE_ORDER) counts[t] = await upsert(tx, t, mapped.tables[t]);
    });
    counts.photos = await uploadPhotos(sql);
    printReport(counts);
    console.log('\n✔ اكتمل الاستيراد. اربط الحسابات بالبريد من: الإدارة ← المستخدمون');
  } catch (e) {
    printReport({});
    console.error(`\n✖ فشل الاستيراد ولم يُحفظ أي سجل: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
main();
