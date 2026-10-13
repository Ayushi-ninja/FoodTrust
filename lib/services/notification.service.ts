/**
 * lib/services/notification.service.ts
 * FoodTrust — Phase 9: Analytics, Notifications & Admin Oversight
 *
 * In-app notification management. No external delivery (email/SMS/push).
 * Supabase Realtime can subscribe on notifications:recipient_user_id=eq.{userId}
 * for live delivery — but this service only manages the DB records.
 *
 * All writes use service-role (admin client) to bypass RLS.
 * IDOR protection is enforced explicitly by matching recipient_user_id.
 */

import { getAdminSupabase } from '@/lib/supabase/admin';
import type { Notification } from '@/types/database.types';

type QueryClient = { from: (table: string) => Record<string, Function> };

function qc(): QueryClient {
  return getAdminSupabase() as unknown as QueryClient;
}

// ---------------------------------------------------------------------------
// List Notifications
// ---------------------------------------------------------------------------

export interface ListNotificationsOptions {
  limit: number;
  offset: number;
  unread_only: boolean;
}

export interface ListNotificationsResult {
  notifications: Notification[];
  total: number;
  unread_count: number;
}

export async function listNotifications(
  userId: string,
  options: ListNotificationsOptions
): Promise<ListNotificationsResult> {
  const client = qc();

  // Build base query
  let query = client
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('recipient_user_id', userId)
    .order('created_at', { ascending: false })
    .range(options.offset, options.offset + options.limit - 1);

  if (options.unread_only) {
    query = (query as unknown as Record<string, Function>).eq('is_read', false);
  }

  const { data, count, error } = await (query as unknown as Promise<{
    data: Notification[] | null;
    count: number | null;
    error: { message: string } | null;
  }>);

  if (error) {
    throw new Error(`Failed to list notifications: ${error.message}`);
  }

  // Unread count (always total unread regardless of filter)
  const { count: unreadCount } = await (client
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_user_id', userId)
    .eq('is_read', false) as unknown as Promise<{ count: number | null; error: unknown }>);

  return {
    notifications: data ?? [],
    total: count ?? 0,
    unread_count: unreadCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Mark Single Notification as Read (IDOR-protected)
// ---------------------------------------------------------------------------

export async function markNotificationRead(
  notificationId: string,
  userId: string
): Promise<Notification> {
  const client = qc();

  const { data, error } = await (client
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('recipient_user_id', userId) // IDOR guard
    .select()
    .single() as unknown as Promise<{
    data: Notification | null;
    error: { message: string; code?: string } | null;
  }>);

  if (error || !data) {
    if (error?.code === 'PGRST116' || !data) {
      throw Object.assign(new Error('Notification not found or access denied.'), {
        statusCode: 404,
      });
    }
    throw new Error(`Failed to mark notification as read: ${error?.message}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Mark All Notifications as Read
// ---------------------------------------------------------------------------

export async function markAllNotificationsRead(
  userId: string
): Promise<{ updated_count: number }> {
  const client = qc();

  const { data, error } = await (client
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_user_id', userId)
    .eq('is_read', false)
    .select('id') as unknown as Promise<{
    data: { id: string }[] | null;
    error: { message: string } | null;
  }>);

  if (error) {
    throw new Error(`Failed to mark all notifications as read: ${error.message}`);
  }

  return { updated_count: (data ?? []).length };
}

// ---------------------------------------------------------------------------
// Create Notification (internal helper — used by other services)
// ---------------------------------------------------------------------------

export interface CreateNotificationParams {
  recipientUserId: string;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export async function createNotification(
  params: CreateNotificationParams
): Promise<Notification> {
  const client = qc();

  const { data, error } = await (client
    .from('notifications')
    .insert({
      recipient_user_id: params.recipientUserId,
      type: params.type,
      title: params.title,
      message: params.message,
      metadata: params.metadata ?? null,
      is_read: false,
      created_at: new Date().toISOString(),
    })
    .select()
    .single() as unknown as Promise<{
    data: Notification | null;
    error: { message: string } | null;
  }>);

  if (error || !data) {
    throw new Error(`Failed to create notification: ${error?.message}`);
  }

  return data;
}
