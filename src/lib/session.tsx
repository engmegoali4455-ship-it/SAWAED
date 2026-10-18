'use client';
// الجلسة والأدوار في الواجهة. الصلاحية الفعلية تفرضها RLS؛ هذا لعرض الأزرار المناسبة فقط.
import type { Session } from '@supabase/supabase-js';
import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db, type Row } from './db';
import { isAssignmentActive, todayRiyadh } from './domain';
import { setMutationUser } from './mutations';
import { startSync, wipeLocal } from './sync';
import { supabase } from './supabase';

export type ProjectRole = 'admin' | 'dept_manager' | 'manager' | 'engineer' | 'owner' | 'contractor' | null;

interface SessionCtx {
  ready: boolean;
  session: Session | null;
  userId: string | null;
  email: string | null;
  profile: Row | undefined;
  isAdmin: boolean;
  isDeptManager: boolean;
  isGlobal: boolean;
  engineer: Row | undefined;
  activeAssignments: Row[];
  projectRole: (projectId: string) => ProjectRole;
  canWrite: (projectId: string) => boolean;
  canDelete: (projectId: string) => boolean;
  canManageProject: (projectId: string) => boolean;
  isExternal: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    setMutationUser(userId);
    if (userId) startSync(userId);
  }, [userId]);

  const profile = useLiveQuery(() => (userId ? db.t('profiles').get(userId) : undefined), [userId]);
  const deptRow = useLiveQuery(() => (userId ? db.t('dept_managers').where('user_id').equals(userId).first() : undefined), [userId]);
  const engineer = useLiveQuery(() => (userId ? db.t('engineers').where('user_id').equals(userId).first() : undefined), [userId]);
  const assignments = useLiveQuery(() => (engineer ? db.t('assignments').where('engineer_id').equals(engineer.id).toArray() : []), [engineer?.id]) ?? [];
  const externals = useLiveQuery(() => (userId ? db.t('project_external_members').where('user_id').equals(userId).toArray() : []), [userId]) ?? [];

  const value = useMemo<SessionCtx>(() => {
    const today = todayRiyadh();
    const isAdmin = !!profile?.is_admin && profile?.is_active !== false;
    const isDeptManager = !!deptRow?.is_active;
    const isGlobal = isAdmin || isDeptManager;
    const engineerActive = engineer?.status === 'active';
    const activeAssignments = engineerActive ? assignments.filter((a) => isAssignmentActive(a as any, today)) : [];
    const projectRole = (pid: string): ProjectRole => {
      if (isAdmin) return 'admin';
      if (isDeptManager) return 'dept_manager';
      const mine = activeAssignments.filter((a) => a.project_id === pid);
      if (mine.some((a) => a.role === 'project_manager')) return 'manager';
      if (mine.length) return 'engineer';
      return (externals.find((x) => x.project_id === pid)?.party as ProjectRole) ?? null;
    };
    const canWrite = (pid: string) => ['admin', 'dept_manager', 'manager', 'engineer'].includes(projectRole(pid) ?? '');
    const canDelete = (pid: string) => ['admin', 'dept_manager', 'manager'].includes(projectRole(pid) ?? '');
    return {
      ready, session, userId, email: session?.user.email ?? null, profile, isAdmin, isDeptManager, isGlobal,
      engineer, activeAssignments, projectRole, canWrite, canDelete, canManageProject: canDelete,
      isExternal: !isGlobal && !activeAssignments.length && externals.length > 0,
      signOut: async () => { await wipeLocal(); await supabase().auth.signOut(); location.href = '/login/'; },
    };
  }, [ready, session, profile, deptRow, engineer, assignments, externals]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside provider');
  return c;
}
