/**
 * lib/auth/session.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Server-side session resolution helper.
 * Resolves the authenticated Supabase Auth user from session cookies and
 * joins with the authoritative public.users database row.
 *
 * CRITICAL SECURITY ARCHITECTURE:
 * - Client-supplied role claims (headers, tokens, body) are NEVER trusted.
 * - The user's role and status are read directly from public.users in the database.
 * - Distinguishes between unauthenticated states and database resolution failures.
 */

import { createServerClient } from '@/lib/supabase/server';
import type { User } from '@/types/database.types';

export type SessionErrorType =
  | 'UNAUTHENTICATED'
  | 'USER_RECORD_NOT_FOUND'
  | 'DATABASE_ERROR';

export interface SessionResult {
  authenticated: boolean;
  user: User | null;
  error?: SessionErrorType;
  message?: string;
}

/**
 * Resolves the current session's authenticated user and database profile.
 * Server-only. Safe for Route Handlers and Server Components.
 */
export async function getSessionUser(): Promise<SessionResult> {
  try {
    const supabase = createServerClient();

    // 1. Verify the session with Supabase Auth
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return {
        authenticated: false,
        user: null,
        error: 'UNAUTHENTICATED',
        message: authError?.message || 'No active authenticated session',
      };
    }

    // 2. Resolve the authoritative application record from public.users
    const { data: dbUser, error: dbError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (dbError) {
      if (dbError.code === 'PGRST116') {
        return {
          authenticated: true,
          user: null,
          error: 'USER_RECORD_NOT_FOUND',
          message: 'Authenticated user does not have a linked public.users profile row',
        };
      }

      return {
        authenticated: true,
        user: null,
        error: 'DATABASE_ERROR',
        message: 'Failed to retrieve application user profile from database',
      };
    }

    return {
      authenticated: true,
      user: dbUser as User,
    };
  } catch (err) {
    return {
      authenticated: false,
      user: null,
      error: 'DATABASE_ERROR',
      message: err instanceof Error ? err.message : 'Unexpected session resolution error',
    };
  }
}
