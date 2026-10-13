/**
 * lib/services/admin.service.ts
 * FoodTrust — Phase 9: Analytics, Notifications & Admin Oversight
 *
 * Administrative operations:
 * - User management (list, status/role update with safety guards)
 * - System config read/write (allowlisted keys only; persisted in DB)
 * - Audit log listing with JSONB sanitization
 *
 * All writes use service-role (admin client).
 * Business rules:
 * - Cannot self-suspend.
 * - Cannot assign SUPER_ADMIN role via API.
 * - Cannot suspend the last active SUPER_ADMIN.
 * - Role changes FROM SUPER_ADMIN require actor to be SUPER_ADMIN.
 */

import { getAdminSupabase } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/services/audit.service';
import type { User, UserRole, UserStatus, AuditLog } from '@/types/database.types';

type QueryClient = { from: (table: string) => Record<string, Function> };

function qc(): QueryClient {
  return getAdminSupabase() as unknown as QueryClient;
}

// ---------------------------------------------------------------------------
// Sensitive JSONB field keys stripped from audit log responses
// ---------------------------------------------------------------------------
const SENSITIVE_KEYS = new Set([
  'otp_code_hash',
  'otp_code',
  'password',
  'token',
  'hash',
  'secret',
  'access_token',
  'refresh_token',
]);

function sanitizeJsonb(
  obj: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!obj) return null;
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!SENSITIVE_KEYS.has(k)) {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// List Users
// ---------------------------------------------------------------------------

export interface ListUsersOptions {
  limit: number;
  offset: number;
  role?: string;
  status?: string;
  search?: string;
}

export interface ListUsersResult {
  users: User[];
  total: number;
}

export async function listUsers(options: ListUsersOptions): Promise<ListUsersResult> {
  const client = qc();

  let query = client
    .from('users')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(options.offset, options.offset + options.limit - 1);

  if (options.role) {
    query = (query as unknown as Record<string, Function>).eq('role', options.role);
  }
  if (options.status) {
    query = (query as unknown as Record<string, Function>).eq('status', options.status);
  }
  if (options.search) {
    // ILIKE search on email or full_name
    query = (query as unknown as Record<string, Function>).or(
      `email.ilike.%${options.search}%,full_name.ilike.%${options.search}%`
    );
  }

  const { data, count, error } = await (query as unknown as Promise<{
    data: User[] | null;
    count: number | null;
    error: { message: string } | null;
  }>);

  if (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }

  return {
    users: data ?? [],
    total: count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Update User (status / role)
// ---------------------------------------------------------------------------

export interface UpdateUserOptions {
  status?: UserStatus;
  role?: UserRole;
}

export async function updateUserStatus(
  targetUserId: string,
  actorId: string,
  actorRole: string,
  update: UpdateUserOptions
): Promise<User> {
  const client = qc();

  // Fetch target user
  const { data: targetUser, error: fetchErr } = await (client
    .from('users')
    .select('*')
    .eq('id', targetUserId)
    .single() as unknown as Promise<{
    data: User | null;
    error: { message: string; code?: string } | null;
  }>);

  if (fetchErr || !targetUser) {
    throw Object.assign(new Error('User not found.'), { statusCode: 404 });
  }

  // Guard: cannot self-suspend
  if (update.status === 'SUSPENDED' && targetUserId === actorId) {
    throw Object.assign(new Error('Cannot suspend your own account.'), { statusCode: 403 });
  }

  // Guard: cannot assign SUPER_ADMIN via API
  if (update.role === 'SUPER_ADMIN') {
    throw Object.assign(
      new Error('SUPER_ADMIN role cannot be assigned via this API.'),
      { statusCode: 403 }
    );
  }

  // Guard: only SUPER_ADMIN can change role away from SUPER_ADMIN
  // Cast update.role to string to avoid TS narrowing overlap error after the SUPER_ADMIN
  // assignment guard above (TS narrows update.role to exclude 'SUPER_ADMIN' at this point)
  if (targetUser.role === 'SUPER_ADMIN' && update.role && (update.role as string) !== 'SUPER_ADMIN') {
    if (actorRole !== 'SUPER_ADMIN') {
      throw Object.assign(
        new Error('Only a SUPER_ADMIN can change the role of another SUPER_ADMIN.'),
        { statusCode: 403 }
      );
    }
  }

  // Guard: cannot suspend last active SUPER_ADMIN
  if (update.status === 'SUSPENDED' && targetUser.role === 'SUPER_ADMIN') {
    const { count } = await (client
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'SUPER_ADMIN')
      .eq('status', 'ACTIVE')
      .neq('id', targetUserId) as unknown as Promise<{ count: number | null }>);

    if ((count ?? 0) === 0) {
      throw Object.assign(
        new Error('Cannot suspend the last active SUPER_ADMIN.'),
        { statusCode: 409 }
      );
    }
  }

  const updatePayload: Record<string, string> = {};
  if (update.status) updatePayload.status = update.status;
  if (update.role) updatePayload.role = update.role;

  const { data: updatedUser, error: updateErr } = await (client
    .from('users')
    .update(updatePayload)
    .eq('id', targetUserId)
    .select()
    .single() as unknown as Promise<{
    data: User | null;
    error: { message: string } | null;
  }>);

  if (updateErr || !updatedUser) {
    throw new Error(`Failed to update user: ${updateErr?.message}`);
  }

  // Audit (best-effort)
  const action = update.role ? 'USER_ROLE_UPDATED' : 'USER_STATUS_UPDATED';
  await logAuditEvent({
    actorId,
    actorRole,
    action,
    targetTable: 'users',
    targetId: targetUserId,
    oldValues: { status: targetUser.status, role: targetUser.role },
    newValues: updatePayload,
  });

  return updatedUser;
}

// ---------------------------------------------------------------------------
// System Config
// ---------------------------------------------------------------------------

export interface SystemConfigRow {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

// Default configuration fallback if migration 000009 has not yet been run on remote Supabase
const DEFAULT_SYSTEM_CONFIG: Record<string, { value: string; description: string }> = {
  kg_per_meal_factor: {
    value: '0.40',
    description: 'FAO standard portion estimate: kg of food per meal served (default 0.40 kg).',
  },
  co2_factor_per_kg: {
    value: '2.50',
    description: 'UNEP Food Waste Index CO2e factor: kg CO2 offset per kg of food redistributed (default 2.50).',
  },
};

// In-memory fallback cache when table is absent in remote database
const inMemoryConfigStore = new Map<string, SystemConfigRow>([
  [
    'kg_per_meal_factor',
    {
      key: 'kg_per_meal_factor',
      value: '0.40',
      description: DEFAULT_SYSTEM_CONFIG.kg_per_meal_factor.description,
      updated_at: new Date().toISOString(),
      updated_by: null,
    },
  ],
  [
    'co2_factor_per_kg',
    {
      key: 'co2_factor_per_kg',
      value: '2.50',
      description: DEFAULT_SYSTEM_CONFIG.co2_factor_per_kg.description,
      updated_at: new Date().toISOString(),
      updated_by: null,
    },
  ],
]);

export async function getSystemConfig(): Promise<SystemConfigRow[]> {
  const client = qc();

  try {
    const { data, error } = await (client
      .from('system_config')
      .select('key,value,description,updated_at,updated_by')
      .order('key') as unknown as Promise<{
      data: SystemConfigRow[] | null;
      error: { message: string; code?: string } | null;
    }>);

    if (error) {
      // Table missing (PGRST204 / schema cache) - fall back to memory store
      if (error.message?.includes('schema cache') || error.code === '42P01') {
        return Array.from(inMemoryConfigStore.values()).sort((a, b) => a.key.localeCompare(b.key));
      }
      throw new Error(`Failed to read system config: ${error.message}`);
    }

    return data ?? [];
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('schema cache') || msg.includes('does not exist')) {
      return Array.from(inMemoryConfigStore.values()).sort((a, b) => a.key.localeCompare(b.key));
    }
    throw err;
  }
}

export async function updateSystemConfig(
  key: string,
  value: string,
  actorId: string
): Promise<SystemConfigRow> {
  const client = qc();

  try {
    const { data, error } = await (client
      .from('system_config')
      .update({ value, updated_by: actorId })
      .eq('key', key)
      .select('key,value,description,updated_at,updated_by')
      .single() as unknown as Promise<{
      data: SystemConfigRow | null;
      error: { message: string; code?: string } | null;
    }>);

    if (error) {
      if (error.message?.includes('schema cache') || error.code === '42P01') {
        const existing = inMemoryConfigStore.get(key);
        if (!existing) {
          throw Object.assign(new Error(`Config key '${key}' not found.`), { statusCode: 404 });
        }
        const updatedRow: SystemConfigRow = {
          ...existing,
          value,
          updated_at: new Date().toISOString(),
          updated_by: actorId,
        };
        inMemoryConfigStore.set(key, updatedRow);

        await logAuditEvent({
          actorId,
          actorRole: 'SUPER_ADMIN',
          action: 'CONFIG_UPDATED',
          targetTable: 'system_config',
          targetId: null,
          newValues: { key, value },
        });

        return updatedRow;
      }

      if (error.code === 'PGRST116') {
        throw Object.assign(new Error(`Config key '${key}' not found.`), { statusCode: 404 });
      }
      throw new Error(`Failed to update config: ${error.message}`);
    }

    if (!data) {
      throw Object.assign(new Error(`Config key '${key}' not found.`), { statusCode: 404 });
    }

    // Audit (best-effort)
    await logAuditEvent({
      actorId,
      actorRole: 'SUPER_ADMIN',
      action: 'CONFIG_UPDATED',
      targetTable: 'system_config',
      targetId: null,
      newValues: { key, value },
    });

    return data;
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('schema cache') || msg.includes('does not exist')) {
      const existing = inMemoryConfigStore.get(key);
      if (!existing) {
        throw Object.assign(new Error(`Config key '${key}' not found.`), { statusCode: 404 });
      }
      const updatedRow: SystemConfigRow = {
        ...existing,
        value,
        updated_at: new Date().toISOString(),
        updated_by: actorId,
      };
      inMemoryConfigStore.set(key, updatedRow);

      await logAuditEvent({
        actorId,
        actorRole: 'SUPER_ADMIN',
        action: 'CONFIG_UPDATED',
        targetTable: 'system_config',
        targetId: null,
        newValues: { key, value },
      });

      return updatedRow;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Audit Logs (with JSONB sanitization)
// ---------------------------------------------------------------------------

export interface SanitizedAuditLog extends Omit<AuditLog, 'old_values' | 'new_values'> {
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}

export interface ListAuditLogsOptions {
  limit: number;
  offset: number;
  actor_id?: string;
  action?: string;
  target_table?: string;
  from_date?: string;
  to_date?: string;
}

export interface ListAuditLogsResult {
  logs: SanitizedAuditLog[];
  total: number;
}

export async function listAuditLogs(
  options: ListAuditLogsOptions
): Promise<ListAuditLogsResult> {
  const client = qc();

  let query = client
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(options.offset, options.offset + options.limit - 1);

  if (options.actor_id) {
    query = (query as unknown as Record<string, Function>).eq('actor_id', options.actor_id);
  }
  if (options.action) {
    query = (query as unknown as Record<string, Function>).ilike('action', `%${options.action}%`);
  }
  if (options.target_table) {
    query = (query as unknown as Record<string, Function>).eq('target_table', options.target_table);
  }
  if (options.from_date) {
    query = (query as unknown as Record<string, Function>).gte('created_at', options.from_date);
  }
  if (options.to_date) {
    query = (query as unknown as Record<string, Function>).lte('created_at', options.to_date);
  }

  const { data, count, error } = await (query as unknown as Promise<{
    data: AuditLog[] | null;
    count: number | null;
    error: { message: string } | null;
  }>);

  if (error) {
    throw new Error(`Failed to list audit logs: ${error.message}`);
  }

  const logs: SanitizedAuditLog[] = (data ?? []).map((log) => ({
    ...log,
    old_values: sanitizeJsonb(log.old_values),
    new_values: sanitizeJsonb(log.new_values),
  }));

  return {
    logs,
    total: count ?? 0,
  };
}
