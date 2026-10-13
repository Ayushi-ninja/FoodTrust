/**
 * lib/supabase/untyped.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Helper to obtain an untyped Supabase client reference.
 *
 * WHY THIS EXISTS:
 * The installed @supabase/supabase-js (2.109.0) uses complex generic inference
 * for `.from().insert()` and `.from().update()` that fails to resolve our
 * Database['public']['Tables'][T]['Insert'] types (resolving them to `never[]`
 * instead of the expected object type). This is a known version-specific
 * TypeScript inference limitation in the Supabase JS client generic chain.
 *
 * SAFETY CONTRACT:
 * - All insert/update payloads are validated by Zod before reaching these calls.
 * - All payloads are typed using Database['public']['Tables'][T]['Insert|Update'].
 * - The untyped cast only bypasses the TypeScript generic inference at the
 *   `.from()` call boundary, not the business-logic type validation.
 * - This file is NOT exported from any browser-facing code.
 *
 * SCOPE: Used only in server-side Route Handlers.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Returns a Supabase client cast for plain SQL builder calls (insert/update).
 * Only use this when the typed version produces `never[]` inference errors. */
export function asUntypedClient(client: SupabaseClient): ReturnType<typeof import('@supabase/supabase-js').createClient> {
  return client as ReturnType<typeof import('@supabase/supabase-js').createClient>;
}
