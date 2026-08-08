import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { StaffRole } from '@penny/db-types';

export type Permission =
  | 'payments.charge'
  | 'payments.refund'
  | 'users.block'
  | 'users.credit'
  | 'zones.edit'
  | 'vehicles.command'
  | 'vehicles.status'
  | 'debts.writeoff'
  | 'tasks.manage'
  | 'settings.edit'
  | 'team.manage'
  | 'verification.review';

const ALL: Permission[] = [
  'payments.charge', 'payments.refund', 'users.block', 'users.credit', 'zones.edit',
  'vehicles.command', 'vehicles.status', 'debts.writeoff', 'tasks.manage', 'settings.edit',
  'team.manage', 'verification.review',
];

const ROLE_PERMS: Record<StaffRole, Permission[]> = {
  owner: ALL,
  admin: ALL,
  support: ['users.block', 'users.credit', 'payments.refund', 'verification.review', 'debts.writeoff'],
  ops_manager: ['vehicles.command', 'vehicles.status', 'tasks.manage', 'zones.edit'],
  ops: ['vehicles.command', 'vehicles.status', 'tasks.manage'],
  accountant: ['payments.charge', 'payments.refund', 'debts.writeoff'],
  readonly: [],
};

export interface CurrentStaff {
  id: string;
  name: string;
  role: StaffRole;
  cityScope: string[];
}

interface AuthCtx {
  staff: CurrentStaff;
  setRole: (role: StaffRole) => void;
  can: (p: Permission) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Mock signed-in staff = owner (all permissions). Role switcher included for demoing gating.
  const [role, setRole] = useState<StaffRole>('owner');
  const value = useMemo<AuthCtx>(() => ({
    staff: { id: 'staff-owner', name: 'Konstantinos', role, cityScope: [] },
    setRole,
    can: (p: Permission) => ROLE_PERMS[role].includes(p),
  }), [role]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
