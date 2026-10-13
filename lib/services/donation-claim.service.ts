/**
 * lib/services/donation-claim.service.ts
 * FoodTrust — Phase 7: NGO Claim Management
 *
 * Centralized business service for NGO donation claims.
 * Enforces atomic state transitions, active-claim constraints,
 * role authorization, and audit trail recording.
 */

import { getAdminSupabase } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/services/audit.service';
import type {
  ClaimStatus,
  DonationClaim,
  FoodDonation,
  User,
} from '@/types/database.types';

export interface CreateClaimParams {
  donationId: string;
  actor: User; // Must have role 'NGO'
  notes?: string;
  ipAddress?: string;
}

export interface ClaimOperationResult {
  success: boolean;
  claim?: DonationClaim;
  donation?: FoodDonation;
  error?: string;
  statusCode: number;
}

export interface ListClaimsParams {
  actor: User;
  status?: ClaimStatus;
  donationId?: string;
  limit?: number;
  offset?: number;
}

type QueryClient = { from: (table: string) => Record<string, Function> };

/**
 * Creates a claim for an eligible food donation by an authenticated, verified NGO.
 *
 * ATOMIC CLAIM CREATION & RACE CONDITION PREVENTION:
 * 1. Step A: Atomically transitions food_donations from 'AVAILABLE' to 'CLAIMED'
 *    via conditional UPDATE WHERE id = donationId AND status = 'AVAILABLE'.
 *    If 0 rows affected, another concurrent request already won -> 409 Conflict.
 * 2. Step B: Inserts the donation_claims row with status 'APPROVED'.
 *    Guarded defensively by the PostgreSQL partial unique index idx_single_active_claim.
 *    If insert fails, compensates by rolling food_donations back to 'AVAILABLE'.
 */
export async function createDonationClaim(
  params: CreateClaimParams
): Promise<ClaimOperationResult> {
  const { donationId, actor, notes, ipAddress } = params;
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as QueryClient;

  // 1. Role Verification: Caller must be an NGO
  if (actor.role !== 'NGO') {
    return {
      success: false,
      error: 'Forbidden: Only authenticated NGO accounts can claim food donations.',
      statusCode: 403,
    };
  }

  // 2. Resolve and verify the NGO Profile
  const { data: ngoProfile, error: ngoErr } = await queryClient
    .from('ngo_profiles')
    .select('id, verification_status, daily_capacity_kg')
    .eq('user_id', actor.id)
    .single();

  if (ngoErr || !ngoProfile) {
    return {
      success: false,
      error: 'NGO profile not found for authenticated user.',
      statusCode: 404,
    };
  }

  const profile = ngoProfile as {
    id: string;
    verification_status: string;
    daily_capacity_kg: number;
  };

  if (profile.verification_status !== 'VERIFIED') {
    return {
      success: false,
      error: `Forbidden: NGO profile must be 'VERIFIED' to claim donations (current status: '${profile.verification_status}').`,
      statusCode: 403,
    };
  }

  // 3. Fetch donation to check existence and capacity
  const { data: donationData, error: donationErr } = await queryClient
    .from('food_donations')
    .select('*')
    .eq('id', donationId)
    .single();

  if (donationErr || !donationData) {
    return {
      success: false,
      error: 'Food donation not found.',
      statusCode: 404,
    };
  }

  const donation = donationData as FoodDonation;

  // 4. Verify donation availability
  if (donation.status !== 'AVAILABLE') {
    return {
      success: false,
      error: `Conflict: Donation is not available for claiming (current status: '${donation.status}').`,
      statusCode: 409,
    };
  }

  // 5. Verify NGO handling capacity
  if (Number(donation.quantity_kg) > Number(profile.daily_capacity_kg)) {
    return {
      success: false,
      error: `Capacity exceeded: Donation quantity (${donation.quantity_kg} kg) exceeds NGO daily capacity (${profile.daily_capacity_kg} kg).`,
      statusCode: 422,
    };
  }

  // 6. ATOMIC OCC STATE TRANSITION (Step A)
  // Transition donation status from 'AVAILABLE' to 'CLAIMED' atomically
  const nowIso = new Date().toISOString();
  const { data: updatedDonations, error: updateErr } = await queryClient
    .from('food_donations')
    .update({
      status: 'CLAIMED',
      updated_at: nowIso,
    })
    .eq('id', donationId)
    .eq('status', 'AVAILABLE') // OCC conditional lock
    .select('*');

  if (updateErr) {
    return {
      success: false,
      error: 'Database error occurred during donation claim reservation.',
      statusCode: 500,
    };
  }

  const updatedDonation = (updatedDonations as FoodDonation[])?.[0];
  if (!updatedDonation) {
    // 0 rows affected -> concurrent request claimed or modified the donation first
    return {
      success: false,
      error: 'Conflict: This donation has already been claimed or modified by another transaction.',
      statusCode: 409,
    };
  }

  // 7. INSERT CLAIM ROW (Step B)
  // Backed by partial unique index idx_single_active_claim on (donation_id) WHERE status IN ('APPROVED', 'PENDING')
  const { data: insertedClaims, error: insertErr } = await queryClient
    .from('donation_claims')
    .insert({
      donation_id: donationId,
      ngo_id: profile.id,
      status: 'APPROVED',
      claimed_at: nowIso,
      responded_at: nowIso,
      notes: notes || null,
    })
    .select('*');

  if (insertErr || !insertedClaims || insertedClaims.length === 0) {
    // Compensating rollback: Revert donation status to AVAILABLE
    await queryClient
      .from('food_donations')
      .update({
        status: 'AVAILABLE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', donationId)
      .eq('status', 'CLAIMED');

    const errCode = (insertErr as { code?: string })?.code;
    if (errCode === '23505') {
      // Unique constraint violation (idx_single_active_claim)
      return {
        success: false,
        error: 'Conflict: An active claim already exists for this donation.',
        statusCode: 409,
      };
    }

    return {
      success: false,
      error: 'Failed to record donation claim.',
      statusCode: 500,
    };
  }

  const claim = (insertedClaims as DonationClaim[])[0];

  // 8. Log Audit Event
  await logAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'DONATION_CLAIM_CREATED',
    targetTable: 'donation_claims',
    targetId: claim.id,
    newValues: {
      donation_id: donationId,
      ngo_id: profile.id,
      status: 'APPROVED',
      notes: notes || null,
    },
    ipAddress,
  });

  return {
    success: true,
    claim,
    donation: updatedDonation,
    statusCode: 201,
  };
}

/**
 * Retrieves a single claim by ID with IDOR protection.
 * Permitted actors:
 * - NGO owner of the claim
 * - Donor owner of the associated donation
 * - ADMIN / SUPER_ADMIN
 */
export async function getClaimById(
  claimId: string,
  actor: User
): Promise<{ success: boolean; claim?: Record<string, unknown>; error?: string; statusCode: number }> {
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as QueryClient;

  const { data: claimData, error: claimErr } = await queryClient
    .from('donation_claims')
    .select(`
      *,
      ngo_profiles (
        id,
        organization_name,
        user_id
      ),
      food_donations (
        id,
        title,
        status,
        quantity_kg,
        pickup_address,
        donor_profiles (
          id,
          business_name,
          user_id
        )
      )
    `)
    .eq('id', claimId)
    .single();

  if (claimErr || !claimData) {
    return {
      success: false,
      error: 'Claim not found.',
      statusCode: 404,
    };
  }

  const claim = claimData as Record<string, any>;
  const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
  const isNgoOwner = claim.ngo_profiles?.user_id === actor.id;
  const isDonorOwner = claim.food_donations?.donor_profiles?.user_id === actor.id;

  if (!isAdmin && !isNgoOwner && !isDonorOwner) {
    return {
      success: false,
      error: 'Forbidden: You do not have permission to view this claim.',
      statusCode: 403,
    };
  }

  return {
    success: true,
    claim,
    statusCode: 200,
  };
}

/**
 * Lists claims filtered according to actor permissions:
 * - NGO: views its own claims
 * - DONOR: views claims on its own donations
 * - ADMIN: views all claims (can filter by status or donationId)
 */
export async function listClaims(
  params: ListClaimsParams
): Promise<{ success: boolean; claims: DonationClaim[]; count: number; offset: number; limit: number; error?: string; statusCode: number }> {
  const { actor, status, donationId, limit = 20, offset = 0 } = params;
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as QueryClient;

  let query = queryClient
    .from('donation_claims')
    .select(`
      *,
      food_donations (
        id,
        title,
        status,
        quantity_kg,
        pickup_address
      ),
      ngo_profiles (
        id,
        organization_name
      )
    `);

  if (actor.role === 'NGO') {
    // Resolve NGO profile
    const { data: ngoProfile } = await queryClient
      .from('ngo_profiles')
      .select('id')
      .eq('user_id', actor.id)
      .single();

    if (!ngoProfile) {
      return { success: true, claims: [], count: 0, offset, limit, statusCode: 200 };
    }
    query = query.eq('ngo_id', (ngoProfile as { id: string }).id);
  } else if (actor.role === 'DONOR') {
    // Resolve Donor profile and filter by donations owned by donor
    const { data: donorProfile } = await queryClient
      .from('donor_profiles')
      .select('id')
      .eq('user_id', actor.id)
      .single();

    if (!donorProfile) {
      return { success: true, claims: [], count: 0, offset, limit, statusCode: 200 };
    }

    // Get donations belonging to this donor
    const { data: donorDonations } = await queryClient
      .from('food_donations')
      .select('id')
      .eq('donor_id', (donorProfile as { id: string }).id);

    const donationIds = (donorDonations as { id: string }[] || []).map((d) => d.id);
    if (donationIds.length === 0) {
      return { success: true, claims: [], count: 0, offset, limit, statusCode: 200 };
    }
    query = query.in('donation_id', donationIds);
  } else if (actor.role !== 'ADMIN' && actor.role !== 'SUPER_ADMIN') {
    return {
      success: false,
      claims: [],
      count: 0,
      offset,
      limit,
      error: 'Forbidden: Unauthorized to list claims.',
      statusCode: 403,
    };
  }

  if (status) {
    query = query.eq('status', status);
  }
  if (donationId) {
    query = query.eq('donation_id', donationId);
  }

  query = query
    .order('claimed_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data: claims, error } = await query;

  if (error) {
    return {
      success: false,
      claims: [],
      count: 0,
      offset,
      limit,
      error: 'Failed to retrieve claims.',
      statusCode: 500,
    };
  }

  const claimList = (claims || []) as DonationClaim[];

  return {
    success: true,
    claims: claimList,
    count: claimList.length,
    offset,
    limit,
    statusCode: 200,
  };
}

/**
 * Rejects an active claim (Donor owner or Admin action).
 * Reverts the associated food donation back to 'AVAILABLE' if it was in 'CLAIMED' or 'RESERVED' status.
 */
export async function rejectDonationClaim(
  claimId: string,
  actor: User,
  reason: string,
  ipAddress?: string
): Promise<ClaimOperationResult> {
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as QueryClient;

  // 1. Fetch claim with donation and donor profile
  const { data: claimData, error: claimErr } = await queryClient
    .from('donation_claims')
    .select(`
      *,
      food_donations (
        id,
        status,
        donor_profiles (
          id,
          user_id
        )
      )
    `)
    .eq('id', claimId)
    .single();

  if (claimErr || !claimData) {
    return {
      success: false,
      error: 'Claim not found.',
      statusCode: 404,
    };
  }

  const claim = claimData as Record<string, any>;
  const donation = claim.food_donations;
  const donorUserId = donation?.donor_profiles?.user_id;

  const isOwner = donorUserId === actor.id;
  const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';

  if (!isOwner && !isAdmin) {
    return {
      success: false,
      error: 'Forbidden: Only the donor owner or an administrator can reject a claim.',
      statusCode: 403,
    };
  }

  // 2. State Check: Can only reject PENDING or APPROVED claims
  if (claim.status !== 'PENDING' && claim.status !== 'APPROVED') {
    return {
      success: false,
      error: `Conflict: Cannot reject claim with status '${claim.status}'.`,
      statusCode: 409,
    };
  }

  const nowIso = new Date().toISOString();

  // 3. Atomically update claim status to REJECTED
  const { data: updatedClaims, error: updateErr } = await queryClient
    .from('donation_claims')
    .update({
      status: 'REJECTED',
      responded_at: nowIso,
      notes: reason,
    })
    .eq('id', claimId)
    .eq('status', claim.status) // OCC
    .select('*');

  if (updateErr || !updatedClaims || updatedClaims.length === 0) {
    return {
      success: false,
      error: 'Conflict: Claim was modified concurrently by another transaction.',
      statusCode: 409,
    };
  }

  const updatedClaim = updatedClaims[0] as DonationClaim;

  // 4. Release donation back to AVAILABLE if it is in CLAIMED or RESERVED state
  let updatedDonation: FoodDonation | undefined;
  if (donation && (donation.status === 'CLAIMED' || donation.status === 'RESERVED')) {
    const { data: donationRows } = await queryClient
      .from('food_donations')
      .update({
        status: 'AVAILABLE',
        updated_at: nowIso,
      })
      .eq('id', donation.id)
      .eq('status', donation.status)
      .select('*');

    updatedDonation = (donationRows as FoodDonation[])?.[0];
  }

  // 5. Log Audit Event
  await logAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'DONATION_CLAIM_REJECTED',
    targetTable: 'donation_claims',
    targetId: claimId,
    oldValues: { status: claim.status },
    newValues: { status: 'REJECTED', reason },
    ipAddress,
  });

  return {
    success: true,
    claim: updatedClaim,
    donation: updatedDonation,
    statusCode: 200,
  };
}
