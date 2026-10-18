// اختبار تكامل لمحرك المزامنة على Supabase محلي حقيقي (supabase start + الاستيراد).
// يُشغَّل بـ: SUPABASE_IT=1 npx vitest run src/lib/sync.integration.test.ts
import 'fake-indexeddb/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const URL = 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;

const run = process.env.SUPABASE_IT ? describe : describe.skip;

run('sync engine on real Supabase', () => {
  let ids: Record<string, string>;
  let engine: typeof import('./sync');
  let mut: typeof import('./mutations');
  let local: typeof import('./db');
  let service: SupabaseClient<any>;
  let pmClient: SupabaseClient<any>;

  beforeAll(async () => {
    service = createClient(URL, SERVICE, { auth: { persistSession: false } });
    pmClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const { seedUsers, DEMO_USERS, DEMO_PASSWORD } = await import('../../scripts/dev-seed-users');
    ids = await seedUsers(URL, SERVICE);
    // تكليف المهندسة سارٍ في بداية الاختبار
    await service.from('assignments').update({ to_date: null }).eq('id', 'a2');
    engine = await import('./sync');
    mut = await import('./mutations');
    local = await import('./db');
    const { supabase } = await import('./supabase');
    const { error } = await supabase().auth.signInWithPassword({ email: DEMO_USERS.eng, password: DEMO_PASSWORD });
    if (error) throw error;
    await pmClient.auth.signInWithPassword({ email: DEMO_USERS.pm, password: DEMO_PASSWORD });
    mut.setMutationUser(ids.eng);
  }, 60_000);

  it('pulls only the projects the engineer is assigned to', async () => {
    await engine.syncOnce(ids.eng);
    const projects = await local.db.t('projects').toArray();
    expect(projects.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(await local.db.t('works').where('project_id').equals('p1').count()).toBeGreaterThan(0);
    expect(await local.db.t('stages').count()).toBe(11);
  });

  it('queues offline writes and pushes them in order, cascading on the server', async () => {
    const vid = await mut.createRecord('violations', { project_id: 'p1', category: 'safety', severity: 'major', description: 'اختبار تكامل: سقالة غير مثبتة' });
    const uid = await mut.createRecord('weekly_updates', { project_id: 'p1', update_date: new Date().toISOString().slice(0, 10), stage_id: 's4', done_text: 'اختبار' });
    await mut.updateRecord('weekly_updates', uid, { labor_count: 22 }); // يُدمج في الإدراج المعلّق
    expect(await local.db.outbox.count()).toBe(2);
    await engine.syncOnce(ids.eng);
    expect(await local.db.outbox.count()).toBe(0);
    const { data: v } = await service.from('violations').select('*').eq('id', vid).single();
    expect(v.created_by).toBe(ids.eng);
    const { data: u } = await service.from('weekly_updates').select('labor_count').eq('id', uid).single();
    expect(u!.labor_count).toBe(22);
    const { data: p } = await service.from('projects').select('current_stage_id').eq('id', 'p1').single();
    expect(p!.current_stage_id).toBe('s4');
    const { data: n } = await service.from('notifications').select('user_id').eq('entity_id', vid);
    expect(n!.map((x) => x.user_id).sort()).toEqual([ids.dept, ids.pm].sort());
  });

  it('detects a conflicting edit from another device and lets the user keep theirs', async () => {
    const before = await local.db.t('works').get('w1');
    await mut.updateRecord('works', 'w1', { actual_progress: 70 });           // جهاز المهندسة (دون اتصال)
    const { error } = await pmClient.from('works').update({ actual_progress: 65, version: before!.version }).eq('id', 'w1');
    expect(error).toBeNull();                                                  // جهاز مدير المشروع سبق
    await engine.syncOnce(ids.eng);
    const conflicts = await local.db.conflicts.toArray();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].server.actual_progress).toBe(65);
    expect(conflicts[0].local.actual_progress).toBe(70);
    await engine.resolveConflict(conflicts[0].id, 'mine');
    await engine.syncOnce(ids.eng);
    const { data } = await service.from('works').select('actual_progress').eq('id', 'w1').single();
    expect(Number(data!.actual_progress)).toBe(70);
    expect(await local.db.conflicts.count()).toBe(0);
  });

  it('engineer delete is refused by RLS and the record is restored locally', async () => {
    await mut.deleteRecord('risks', 'r1');
    expect(await local.db.t('risks').get('r1')).toBeUndefined();
    await engine.syncOnce(ids.eng);
    expect(await local.db.t('risks').get('r1')).toBeDefined();
    const { data } = await service.from('risks').select('id').eq('id', 'r1');
    expect(data).toHaveLength(1);
  });

  it('applies server deletes through tombstones', async () => {
    await service.from('meeting_actions').insert({ id: 'it-ma', meeting_id: 'm1', project_id: 'p1', item: 'حذف لاحقاً' });
    await engine.syncOnce(ids.eng);
    expect(await local.db.t('meeting_actions').get('it-ma')).toBeDefined();
    await service.from('meeting_actions').delete().eq('id', 'it-ma');
    await engine.syncOnce(ids.eng);
    expect(await local.db.t('meeting_actions').get('it-ma')).toBeUndefined();
  });

  it('ending an assignment purges that project from the device', async () => {
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    await service.from('assignments').update({ from_date: '2026-01-01', to_date: yesterday }).eq('id', 'a2');
    await engine.syncOnce(ids.eng);
    expect(await local.db.t('projects').get('p1')).toBeUndefined();
    expect(await local.db.t('works').where('project_id').equals('p1').count()).toBe(0);
    expect(await local.db.t('projects').get('p2')).toBeDefined();   // ما زالت مكلّفة على p2
    await service.from('assignments').update({ to_date: null }).eq('id', 'a2');
    await engine.syncOnce(ids.eng);
    expect(await local.db.t('works').where('project_id').equals('p1').count()).toBeGreaterThan(0); // يعود كاملاً
  });
});
