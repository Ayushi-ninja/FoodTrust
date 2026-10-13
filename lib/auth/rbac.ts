/**
 * lib/auth/rbac.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Role-Based Access Control (RBAC) guard utilities.
 * Enforces server-side permissions for API Route Handlers.
 *
 * HTTP STATUS SEMANTICS:
 * - Unauthenticated request: HTTP 401 Unauthorized
 * - Authenticated but unauthorized (wrong role, suspended): HTTP 403 Forbidden
 * - Database resolution error: HTTP 500
 */

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/utils/api-response';
import type { User, UserRole } from '@/types/database.types';

export type AuthSuccessResult = {
  user: User;
  errorResponse: null;
};

export type AuthFailureResult = {
  user: null;
  errorResponse: NextResponse;
};

export type AuthGuardResult = AuthSuccessResult | AuthFailureResult;

/**
 * Requires an active, authenticated user session.
 * Rejects unauthenticated requests with HTTP 401.
 * Rejects suspended users with HTTP 403.
 */
export async function requireAuth(): Promise<AuthGuardResult> {
  const session = await getSessionUser();

  if (!session.authenticated || !session.user) {
    const isDbError = session.error === 'DATABASE_ERROR';
    const status = isDbError ? 500 : 401;
    const message = isDbError
      ? 'An error occurred while verifying your session profile.'
      : 'Authentication required. Please log in.';

    return {
      user: null,
      errorResponse: errorResponse(message, status, { code: session.error || 'UNAUTHENTICATED' }),
    };
  }

  if (session.user.status === 'SUSPENDED') {
    return {
      user: null,
      errorResponse: errorResponse('Account is suspended. Please contact support.', 403, {
        code: 'ACCOUNT_SUSPENDED',
      }),
    };
  }

  return {
    user: session.user,
    errorResponse: null,
  };
}

/**
 * Requires the authenticated user to hold an exact specified role.
 * Rejects unauthenticated requests with HTTP 401.
 * Rejects authenticated requests with inadequate permissions with HTTP 403.
 * (Note: SUPER_ADMIN satisfies ADMIN requirements).
 */
export async function requireRole(expectedRole: UserRole): Promise<AuthGuardResult> {
  const auth = await requireAuth();
  if (auth.errorResponse) {
    return auth;
  }

  const isAuthorized =
    auth.user.role === expectedRole ||
    (expectedRole === 'ADMIN' && auth.user.role === 'SUPER_ADMIN');

  if (!isAuthorized) {
    return {
      user: null,
      errorResponse: errorResponse(
        `Forbidden: Access requires the ${expectedRole} role.`,
        403,
        {
          code: 'INSUFFICIENT_PERMISSIONS',
          requiredRole: expectedRole,
          actualRole: auth.user.role,
        }
      ),
    };
  }

  return auth;
}

/**
 * Requires the authenticated user to hold at least one of the specified allowed roles.
 * Rejects unauthenticated requests with HTTP 401.
 * Rejects authenticated requests without an allowed role with HTTP 403.
 */
export async function requireAnyRole(allowedRoles: UserRole[]): Promise<AuthGuardResult> {
  const auth = await requireAuth();
  if (auth.errorResponse) {
    return auth;
  }

  const effectiveRoles = allowedRoles.includes('ADMIN')
    ? [...allowedRoles, 'SUPER_ADMIN']
    : allowedRoles;

  if (!effectiveRoles.includes(auth.user.role)) {
    return {
      user: null,
      errorResponse: errorResponse(
        `Forbidden: Access requires one of [${allowedRoles.join(', ')}].`,
        403,
        {
          code: 'INSUFFICIENT_PERMISSIONS',
          allowedRoles,
          actualRole: auth.user.role,
        }
      ),
    };
  }

  return auth;
}
