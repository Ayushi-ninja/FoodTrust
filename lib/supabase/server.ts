/**
 * lib/supabase/server.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Server-side Supabase client factory for Route Handlers and Server Components.
 * Reads and manages user sessions from request/response cookies using @supabase/ssr.
 * Evaluates all queries under the Row Level Security (RLS) context of the authenticated user.
 * Never uses the service-role key.
 */

import { createServerClient as _createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database.types';

type CookieOptions = Parameters<ReturnType<typeof cookies>['set']>[2];

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

export function createServerClient() {
  const cookieStore = cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      '[FoodTrust] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY'
    );
  }

  return _createServerClient<Database>(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Invoked from Server Component context where cookies cannot be mutated.
            // Ignored as Route Handlers and Middleware handle mutations.
          }
        },
      },
    }
  );
}
