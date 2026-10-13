/**
 * lib/services/donation-lifecycle.service.ts
 * FoodTrust — Phase 6: Food Donation Lifecycle Management
 *
 * STATE MACHINE & TRANSITION MATRIX:
 *   AVAILABLE
 *     ├──> RESERVED (via matching/claim workflow)
 *     ├──> CANCELLED (donor/admin action)
 *     └──> EXPIRED (shelf-life expiration)
 *
 *   RESERVED
 *     ├──> CLAIMED (NGO formal confirmation)
 *     ├──> AVAILABLE (claim expired / released)
 *     ├──> CANCELLED (donor/admin action)
 *     └──> EXPIRED (shelf-life expiration)
 *
 *   CLAIMED
 *     ├──> PICKUP_IN_PROGRESS (volunteer dispatched)
 *     ├──> CANCELLED (donor cancellation or mutual agreement)
 *     └──> EXPIRED (shelf-life expiration)
 *
 *   PICKUP_IN_PROGRESS
 *     └──> PICKED_UP (OTP handoff complete)
 *
 *   PICKED_UP
 *     └──> DELIVERED (delivery confirmation photo / drop-off)
 *
 *   DELIVERED  -> [TERMINAL STATE]
 *   CANCELLED  -> [TERMINAL STATE]
 *   EXPIRED    -> [TERMINAL STATE]
 *
 * ATOMICITY & RACE CONDITION PREVENTION:
 * State transitions perform atomic conditional SQL updates:
 *   UPDATE food_donations
 *   SET status = target_status, updated_at = NOW()
 *   WHERE id = donation_id AND status = current_expected_status
 * If zero rows are affected, an optimistic locking conflict (HTTP 409) is returned.
 */

import { getAdminSupabase } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/services/audit.service';
import type { DonationStatus, FoodDonation, User } from '@/types/database.types';

export const VALID_TRANSITIONS: Record<DonationStatus, DonationStatus[]> = {
  AVAILABLE: ['RESERVED', 'CANCELLED', 'EXPIRED'],
  RESERVED: ['CLAIMED', 'AVAILABLE', 'CANCELLED', 'EXPIRED'],
  CLAIMED: ['PICKUP_IN_PROGRESS', 'CANCELLED', 'EXPIRED'],
  PICKUP_IN_PROGRESS: ['PICKED_UP'],
  PICKED_UP: ['DELIVERED'],
  DELIVERED: [], // Terminal
  CANCELLED: [], // Terminal
  EXPIRED: [], // Terminal
};

export interface StateTransitionParams {
  donationId: string;
  targetStatus: DonationStatus;
  actor: User;
  reason?: string;
  ipAddress?: string;
}

export interface StateTransitionResult {
  success: boolean;
  donation?: FoodDonation;
  previousStatus?: DonationStatus;
  newStatus?: DonationStatus;
  error?: string;
  statusCode?: number;
}

/**
 * Checks whether transitioning from currentStatus to targetStatus is valid.
 */
export function isValidTransition(
  currentStatus: DonationStatus,
  targetStatus: DonationStatus
): boolean {
  const allowed = VALID_TRANSITIONS[currentStatus] || [];
  return allowed.includes(targetStatus);
}

/**
 * Executes a controlled, atomic status transition on a food donation.
 */
export async function transitionDonationStatus(
  params: StateTransitionParams
): Promise<StateTransitionResult> {
  const { donationId, targetStatus, actor, reason, ipAddress } = params;
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as {
    from: (table: string) => Record<string, Function>;
  };

  // 1. Fetch current donation record with donor profile linkage
  const { data: donationData, error: fetchError } = await queryClient
    .from('food_donations')
    .select(`
      *,
      donor_profiles (
        id,
        user_id
      )
    `)
    .eq('id', donationId)
    .single();

  if (fetchError || !donationData) {
    return {
      success: false,
      error: 'Donation not found.',
      statusCode: 404,
    };
  }

  const donation = donationData as FoodDonation & {
    donor_profiles: { id: string; user_id: string };
  };
  const currentStatus = donation.status;

  // 2. Authorization Verification
  const donorUserId = donation.donor_profiles?.user_id;
  const isOwner = donorUserId === actor.id;
  const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';

  // Role-based transition permissions
  if (targetStatus === 'CANCELLED') {
    // Only the donor owner or admin can cancel a donation
    if (!isOwner && !isAdmin) {
      return {
        success: false,
        error: 'Forbidden: You do not have permission to cancel this donation.',
        statusCode: 403,
      };
    }
  } else if (!isAdmin && !isOwner) {
    // Other transitions require explicit actor permission
    return {
      success: false,
      error: 'Forbidden: Unauthorized to transition donation status.',
      statusCode: 403,
    };
  }

  // 3. Check State Machine Validity
  if (!isValidTransition(currentStatus, targetStatus)) {
    return {
      success: false,
      error: `Invalid status transition: cannot transition from ${currentStatus} to ${targetStatus}.`,
      statusCode: 409,
    };
  }

  // 4. Atomic Conditional Update (Optimistic Concurrency Control)
  // Ensures another concurrent request has not changed the status in between
  const updatedAt = new Date().toISOString();
  const { data: updatedRows, error: updateError } = await queryClient
    .from('food_donations')
    .update({
      status: targetStatus,
      updated_at: updatedAt,
    })
    .eq('id', donationId)
    .eq('status', currentStatus) // OCC: condition on expected current status
    .select('*');

  if (updateError) {
    return {
      success: false,
      error: 'Database error occurred during status update.',
      statusCode: 500,
    };
  }

  const updatedDonation = (updatedRows as FoodDonation[])?.[0];
  if (!updatedDonation) {
    // 0 rows affected -> concurrent state modification conflict
    return {
      success: false,
      error: 'Conflict: Donation status was modified concurrently by another process.',
      statusCode: 409,
    };
  }

  // 5. Append Audit Log
  await logAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: targetStatus === 'CANCELLED' ? 'DONATION_CANCELLED' : 'DONATION_STATUS_CHANGED',
    targetTable: 'food_donations',
    targetId: donationId,
    oldValues: { status: currentStatus },
    newValues: { status: targetStatus, reason: reason || null },
    ipAddress,
  });

  return {
    success: true,
    donation: updatedDonation,
    previousStatus: currentStatus,
    newStatus: targetStatus,
    statusCode: 200,
  };
}
