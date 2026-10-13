/**
 * lib/supabase/client.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Browser-safe Supabase client factory using @supabase/ssr.
 * Safe for use in client components and browser utilities.
 * Exposes ONLY NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
 * Never references or exposes SUPABASE_SERVICE_ROLE_KEY.
 */

import { createBrowserClient as _createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database.types';

export function createBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      '[FoodTrust] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY'
    );
  }

  return _createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
