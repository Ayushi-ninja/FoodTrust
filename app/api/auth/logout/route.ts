/**
 * app/api/auth/logout/route.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Session revocation endpoint.
 * Signs the user out from Supabase Auth and clears session cookies.
 */

import { createServerClient } from '@/lib/supabase/server';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

export async function POST() {
  try {
    const supabase = createServerClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      return errorResponse(error.message, 500, { code: error.code });
    }

    return successResponse(null, 'Successfully signed out', 200);
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during logout',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
