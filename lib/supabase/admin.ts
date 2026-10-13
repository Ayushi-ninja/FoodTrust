/**
 * lib/supabase/admin.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Service-role Supabase client.
 *
 * CRITICAL SECURITY ARCHITECTURE:
 * - This client BYPASSES Row Level Security (RLS) using SUPABASE_SERVICE_ROLE_KEY.
 * - It MUST NEVER be imported into browser/client components.
 * - It MUST ONLY be used for trusted server-side system operations:
 *   1. Initial user profile creation during registration before session cookies are set
 *   2. Administrative actions (status changes, verification)
 *   3. IoT sensor telemetry ingestion (Phase 3)
 *   4. System audit logging and internal notification generation
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

// Runtime browser-isolation guard
if (typeof window !== 'undefined') {
  throw new Error(
    '[FoodTrust Security Violation] lib/supabase/admin.ts is a server-only module and must never be loaded in the browser.'
  );
}

let _adminClient: SupabaseClient<Database> | null = null;

/**
 * Returns the singleton service-role client.
 * Bypasses RLS. Server-only.
 */
export function getAdminSupabase(): SupabaseClient<Database> {
  if (typeof window !== 'undefined') {
    throw new Error(
      '[FoodTrust Security Violation] getAdminSupabase() cannot be called in the browser.'
    );
  }

  if (!_adminClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        '[FoodTrust] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment configuration.'
      );
    }

    _adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return _adminClient;
}
