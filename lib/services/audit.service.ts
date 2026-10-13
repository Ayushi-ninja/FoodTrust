/**
 * lib/services/audit.service.ts
 * FoodTrust — Audit Logging Service
 *
 * Appends immutable audit trail snapshots to public.audit_logs.
 * Strictly avoids logging secrets, credentials, or personal tokens.
 */

import { getAdminSupabase } from '@/lib/supabase/admin';

export interface AuditLogEntry {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  targetTable: string;
  targetId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    const adminSupabase = getAdminSupabase();
    const queryClient = adminSupabase as unknown as {
      from: (table: string) => Record<string, Function>;
    };

    await queryClient.from('audit_logs').insert({
      actor_id: entry.actorId || null,
      actor_role: entry.actorRole || null,
      action: entry.action,
      target_table: entry.targetTable,
      target_id: entry.targetId || null,
      old_values: entry.oldValues || null,
      new_values: entry.newValues || null,
      ip_address: entry.ipAddress || null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Non-blocking logging failure
    console.error('Failed to append audit_log entry:', err);
  }
}
