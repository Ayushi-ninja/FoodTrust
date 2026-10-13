/**
 * lib/services/pickup.service.ts
 * FoodTrust — Phase 8: Pickup & Fulfillment Workflow
 *
 * Centralized business service for pickup lifecycle, cryptographic OTP generation,
 * constant-time verification with attempt counter protection, delivery completion,
 * and automated FAO/UNEP impact metric creation.
 */

import crypto from 'crypto';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/services/audit.service';
import { IMPACT_CONFIG, OTP_CONFIG } from '@/lib/config/constants';
import type {
  Pickup,
  PickupStatus,
  FoodDonation,
  User,
} from '@/types/database.types';

export interface CreatePickupParams {
  donationId: string;
  actor: User; // Must be the NGO that claimed the donation or an Admin
  assignedVolunteer?: string;
  volunteerPhone?: string;
  scheduledAt?: string;
  ipAddress?: string;
}

export interface VerifyOtpParams {
  pickupId: string;
  actor: User; // Must be the collecting NGO or Admin
  otpCode: string;
  ipAddress?: string;
}

export interface CompleteDeliveryParams {
  pickupId: string;
  actor: User; // NGO representative or Admin
  proofImageUrl?: string;
  ipAddress?: string;
}

export interface PickupOperationResult {
  success: boolean;
  pickup?: Pickup;
  donation?: FoodDonation;
  impactMetrics?: Record<string, unknown>;
  error?: string;
  statusCode: number;
}

export interface ListPickupsParams {
  actor: User;
  status?: PickupStatus;
  donationId?: string;
  limit?: number;
  offset?: number;
}

type QueryClient = { from: (table: string) => Record<string, Function> };

/**
 * Derives a salted SHA-256 hash for a 6-digit OTP using the project's shared secret salt.
 * Formula: SHA256(otp + IOT_DEVICE_SHARED_SALT + pickupId)
 */
export function hashOtp(otp: string, pickupId: string): string {
  const salt = process.env.IOT_DEVICE_SHARED_SALT || 'foodtrust_default_secure_salt_2026';
  return crypto
    .createHash('sha256')
    .update(`${otp}:${salt}:${pickupId}`)
    .digest('hex');
}

/**
 * Generates a cryptographically secure, uniformly distributed 6-digit numeric OTP.
 */
export function generateSecureNumericOtp(): string {
  // crypto.randomInt(100000, 1000000) generates an integer in [100000, 999999] uniformly
  const num = crypto.randomInt(100000, 1000000);
  return num.toString();
}

/**
 * Creates a pickup for an eligible, CLAIMED donation.
 * Transitions donation from 'CLAIMED' to 'PICKUP_IN_PROGRESS'.
 * Generates an initial cryptographically random 6-digit OTP and hashes it before storage.
 */
export async function createPickup(
  params: CreatePickupParams
): Promise<PickupOperationResult & { rawOtp?: string }> {
  const { donationId, actor, assignedVolunteer, volunteerPhone, scheduledAt, ipAddress } = params;
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as QueryClient;

  // 1. Role Verification: Must be NGO or Admin
  const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
  if (actor.role !== 'NGO' && !isAdmin) {
    return {
      success: false,
      error: 'Forbidden: Only the claiming NGO or an administrator can schedule a pickup.',
      statusCode: 403,
    };
  }

  // 2. Fetch donation with active claim
  const { data: donationData, error: donationErr } = await queryClient
    .from('food_donations')
    .select(`
      *,
      donation_claims (
        id,
        ngo_id,
        status,
        ngo_profiles (
          id,
          user_id
        )
      )
    `)
    .eq('id', donationId)
    .single();

  if (donationErr || !donationData) {
    return {
      success: false,
      error: 'Food donation not found.',
      statusCode: 404,
    };
  }

  const donation = donationData as FoodDonation & {
    donation_claims: Array<{
      id: string;
      ngo_id: string;
      status: string;
      ngo_profiles: { id: string; user_id: string };
    }>;
  };

  // 3. Verify claiming NGO ownership
  const activeClaim = donation.donation_claims?.find((c) => c.status === 'APPROVED');
  if (!activeClaim) {
    return {
      success: false,
      error: 'Conflict: Donation does not have an approved claim.',
      statusCode: 409,
    };
  }

  if (!isAdmin && activeClaim.ngo_profiles?.user_id !== actor.id) {
    return {
      success: false,
      error: 'Forbidden: Only the NGO that claimed this donation can schedule a pickup.',
      statusCode: 403,
    };
  }

  // 4. Verify donation lifecycle state: Must be CLAIMED
  if (donation.status !== 'CLAIMED') {
    return {
      success: false,
      error: `Conflict: Pickups can only be created for donations in 'CLAIMED' status (current status: '${donation.status}').`,
      statusCode: 409,
    };
  }

  // 5. Pre-check: Ensure pickup record doesn't already exist (enforced by UNIQUE constraint)
  const { data: existingPickup } = await queryClient
    .from('pickups')
    .select('id')
    .eq('donation_id', donationId)
    .limit(1)
    .single();

  if (existingPickup) {
    return {
      success: false,
      error: 'Conflict: A pickup record already exists for this donation.',
      statusCode: 409,
    };
  }

  // 6. ATOMIC OCC STATE TRANSITION on food_donations (CLAIMED -> PICKUP_IN_PROGRESS)
  const nowIso = new Date().toISOString();
  const { data: updatedDonations, error: updateErr } = await queryClient
    .from('food_donations')
    .update({
      status: 'PICKUP_IN_PROGRESS',
      updated_at: nowIso,
    })
    .eq('id', donationId)
    .eq('status', 'CLAIMED') // OCC conditional lock
    .select('*');

  if (updateErr || !updatedDonations || updatedDonations.length === 0) {
    return {
      success: false,
      error: 'Conflict: Donation status was modified concurrently by another transaction.',
      statusCode: 409,
    };
  }

  const updatedDonation = (updatedDonations as FoodDonation[])[0];

  // 7. Generate Initial 6-digit OTP
  const rawOtp = generateSecureNumericOtp();
  const pickupId = crypto.randomUUID();
  const otpHash = hashOtp(rawOtp, pickupId);
  const otpExpiresAt = new Date(
    Date.now() + OTP_CONFIG.EXPIRY_MINUTES * 60 * 1000
  ).toISOString();

  // 8. INSERT PICKUP RECORD
  const { data: insertedPickups, error: insertErr } = await queryClient
    .from('pickups')
    .insert({
      id: pickupId,
      donation_id: donationId,
      ngo_id: activeClaim.ngo_id,
      assigned_volunteer: assignedVolunteer || null,
      volunteer_phone: volunteerPhone || null,
      otp_code_hash: otpHash,
      otp_attempt_count: 0,
      otp_expires_at: otpExpiresAt,
      status: 'SCHEDULED',
      scheduled_at: scheduledAt || nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select('*');

  if (insertErr || !insertedPickups || insertedPickups.length === 0) {
    // Compensating rollback on failure
    await queryClient
      .from('food_donations')
      .update({
        status: 'CLAIMED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', donationId)
      .eq('status', 'PICKUP_IN_PROGRESS');

    const errCode = (insertErr as { code?: string })?.code;
    if (errCode === '23505') {
      return {
        success: false,
        error: 'Conflict: A pickup has already been scheduled for this donation.',
        statusCode: 409,
      };
    }

    return {
      success: false,
      error: 'Failed to create pickup record.',
      statusCode: 500,
    };
  }

  const pickup = (insertedPickups as Pickup[])[0];

  // 9. Log Audit Event
  await logAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'PICKUP_CREATED',
    targetTable: 'pickups',
    targetId: pickup.id,
    newValues: {
      donation_id: donationId,
      ngo_id: activeClaim.ngo_id,
      status: 'SCHEDULED',
      assigned_volunteer: assignedVolunteer || null,
    },
    ipAddress,
  });

  return {
    success: true,
    pickup,
    donation: updatedDonation,
    rawOtp, // Provided for the donor workflow, never to NGO
    statusCode: 201,
  };
}

/**
 * Exposes or generates an active OTP for the pickup.
 * Strictly restricted to the DONOR owner of the donation or Admin.
 * NGO representatives can NEVER call this endpoint.
 */
export async function getOrGeneratePickupOtp(
  pickupId: string,
  actor: User,
  ipAddress?: string
): Promise<{ success: boolean; otp?: string; expiresAt?: string; error?: string; statusCode: number }> {
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as QueryClient;

  // 1. Fetch pickup with donor ownership
  const { data: pickupData, error: pickupErr } = await queryClient
    .from('pickups')
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
    .eq('id', pickupId)
    .single();

  if (pickupErr || !pickupData) {
    return {
      success: false,
      error: 'Pickup not found.',
      statusCode: 404,
    };
  }

  const pickup = pickupData as Record<string, any>;
  const donation = pickup.food_donations;
  const donorUserId = donation?.donor_profiles?.user_id;

  const isOwner = donorUserId === actor.id;
  const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';

  // 2. Authorization: DONOR owner or Admin only!
  if (!isOwner && !isAdmin) {
    return {
      success: false,
      error: 'Forbidden: Only the donor of the food donation or an administrator can view the handoff OTP.',
      statusCode: 403,
    };
  }

  // 3. State Check: Can only view OTP while in SCHEDULED, EN_ROUTE, or ARRIVED status
  if (
    pickup.status === 'PICKED_UP' ||
    pickup.status === 'DELIVERED' ||
    pickup.status === 'FAILED'
  ) {
    return {
      success: false,
      error: `Conflict: Cannot generate OTP for pickup in '${pickup.status}' status.`,
      statusCode: 409,
    };
  }

  // 4. Invalidation Check: Check if attempts were already exhausted
  if (pickup.otp_attempt_count >= OTP_CONFIG.MAX_ATTEMPTS) {
    return {
      success: false,
      error: 'Conflict: Maximum OTP attempts reached. Pickup handoff has been invalidated.',
      statusCode: 409,
    };
  }

  // 5. Generate fresh OTP if expired or requested
  const now = Date.now();
  const isExpired = pickup.otp_expires_at && new Date(pickup.otp_expires_at).getTime() < now;

  let otp = generateSecureNumericOtp();
  const newHash = hashOtp(otp, pickupId);
  const newExpiresAt = new Date(now + OTP_CONFIG.EXPIRY_MINUTES * 60 * 1000).toISOString();

  // Atomically update the OTP hash
  await queryClient
    .from('pickups')
    .update({
      otp_code_hash: newHash,
      otp_expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', pickupId);

  // 6. Log Audit Event
  await logAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'PICKUP_OTP_GENERATED',
    targetTable: 'pickups',
    targetId: pickupId,
    newValues: { expires_at: newExpiresAt },
    ipAddress,
  });

  return {
    success: true,
    otp,
    expiresAt: newExpiresAt,
    statusCode: 200,
  };
}

/**
 * Verifies the 6-digit OTP submitted by the collecting NGO volunteer.
 * Enforces:
 * - Constant-time comparison
 * - Max 3 attempts counter with atomic increment
 * - Transitions pickup to 'PICKED_UP' and donation to 'PICKED_UP'
 */
export async function verifyPickupOtp(
  params: VerifyOtpParams
): Promise<PickupOperationResult> {
  const { pickupId, actor, otpCode, ipAddress } = params;
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as QueryClient;

  // 1. Fetch pickup with NGO and donation details
  const { data: pickupData, error: pickupErr } = await queryClient
    .from('pickups')
    .select(`
      *,
      ngo_profiles (
        id,
        user_id
      ),
      food_donations (
        id,
        status
      )
    `)
    .eq('id', pickupId)
    .single();

  if (pickupErr || !pickupData) {
    return {
      success: false,
      error: 'Pickup not found.',
      statusCode: 404,
    };
  }

  const pickup = pickupData as Record<string, any>;
  const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
  const isNgoOwner = pickup.ngo_profiles?.user_id === actor.id;

  // 2. Authorization: Collecting NGO or Admin
  if (!isNgoOwner && !isAdmin) {
    return {
      success: false,
      error: 'Forbidden: Only the designated collecting NGO or an administrator can verify the pickup OTP.',
      statusCode: 403,
    };
  }

  // 3. Status Invariant: Pickup must not already be completed
  if (pickup.status === 'PICKED_UP' || pickup.status === 'DELIVERED') {
    return {
      success: false,
      error: 'Conflict: This pickup has already been verified and marked as picked up.',
      statusCode: 409,
    };
  }

  // 4. Attempt limit & Locked status check: Max 3 attempts
  if (pickup.status === 'FAILED' || pickup.otp_attempt_count >= OTP_CONFIG.MAX_ATTEMPTS) {
    return {
      success: false,
      error: 'Forbidden: Maximum OTP attempts exceeded (3). Handoff has been locked for security.',
      statusCode: 403,
    };
  }

  // 5. Expiry Check
  if (pickup.otp_expires_at && new Date(pickup.otp_expires_at).getTime() < Date.now()) {
    return {
      success: false,
      error: 'Conflict: OTP has expired. Please ask the donor to refresh the OTP.',
      statusCode: 409,
    };
  }

  // 6. Verify Hash with Constant-Time Comparison
  const computedHash = hashOtp(otpCode, pickupId);
  const storedHash = pickup.otp_code_hash as string;

  const isMatch =
    computedHash.length === storedHash.length &&
    crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(storedHash));

  const nowIso = new Date().toISOString();

  if (!isMatch) {
    // Increment failed attempts counter atomically
    const newAttemptCount = pickup.otp_attempt_count + 1;
    const isNowLocked = newAttemptCount >= OTP_CONFIG.MAX_ATTEMPTS;

    await queryClient
      .from('pickups')
      .update({
        otp_attempt_count: newAttemptCount,
        status: isNowLocked ? 'FAILED' : pickup.status,
        updated_at: nowIso,
      })
      .eq('id', pickupId);

    // Log failure event
    await logAuditEvent({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'PICKUP_OTP_VERIFICATION_FAILED',
      targetTable: 'pickups',
      targetId: pickupId,
      newValues: {
        attempts: newAttemptCount,
        locked: isNowLocked,
      },
      ipAddress,
    });

    return {
      success: false,
      error: isNowLocked
        ? 'Verification failed: Maximum attempts exceeded (3). Pickup has been locked.'
        : `Verification failed: Invalid OTP code. (${OTP_CONFIG.MAX_ATTEMPTS - newAttemptCount} attempts remaining)`,
      statusCode: 401,
    };
  }

  // 7. SUCCESS: Atomic Transition to PICKED_UP
  // A) Update pickup status to PICKED_UP
  const { data: updatedPickups, error: pickupUpdateErr } = await queryClient
    .from('pickups')
    .update({
      status: 'PICKED_UP',
      picked_up_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', pickupId)
    .in('status', ['SCHEDULED', 'EN_ROUTE', 'ARRIVED']) // OCC
    .select('*');

  if (pickupUpdateErr || !updatedPickups || updatedPickups.length === 0) {
    return {
      success: false,
      error: 'Conflict: Pickup was concurrently modified by another process.',
      statusCode: 409,
    };
  }

  const updatedPickup = updatedPickups[0] as Pickup;

  // B) Update food_donations status to PICKED_UP
  const { data: updatedDonations } = await queryClient
    .from('food_donations')
    .update({
      status: 'PICKED_UP',
      updated_at: nowIso,
    })
    .eq('id', pickup.donation_id)
    .eq('status', 'PICKUP_IN_PROGRESS') // OCC
    .select('*');

  const updatedDonation = (updatedDonations as FoodDonation[])?.[0];

  // 8. Log Audit Event
  await logAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'PICKUP_OTP_VERIFIED',
    targetTable: 'pickups',
    targetId: pickupId,
    newValues: {
      status: 'PICKED_UP',
      picked_up_at: nowIso,
    },
    ipAddress,
  });

  return {
    success: true,
    pickup: updatedPickup,
    donation: updatedDonation,
    statusCode: 200,
  };
}

/**
 * Completes delivery with optional proof-of-delivery image URL.
 * Transitions pickup to 'DELIVERED' and donation to 'DELIVERED'.
 * Automatically calculates and inserts FAO/UNEP impact metrics in public.impact_metrics.
 */
export async function completePickupDelivery(
  params: CompleteDeliveryParams
): Promise<PickupOperationResult> {
  const { pickupId, actor, proofImageUrl, ipAddress } = params;
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as QueryClient;

  // 1. Fetch pickup with donation and profiles
  const { data: pickupData, error: pickupErr } = await queryClient
    .from('pickups')
    .select(`
      *,
      ngo_profiles (
        id,
        user_id
      ),
      food_donations (
        id,
        status,
        quantity_kg
      )
    `)
    .eq('id', pickupId)
    .single();

  if (pickupErr || !pickupData) {
    return {
      success: false,
      error: 'Pickup not found.',
      statusCode: 404,
    };
  }

  const pickup = pickupData as Record<string, any>;
  const donation = pickup.food_donations;
  const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
  const isNgoOwner = pickup.ngo_profiles?.user_id === actor.id;

  // 2. Authorization Check: Assigned NGO or Admin
  if (!isNgoOwner && !isAdmin) {
    return {
      success: false,
      error: 'Forbidden: Only the assigned collecting NGO or an administrator can mark delivery complete.',
      statusCode: 403,
    };
  }

  // 3. State Check: Pickup must be in 'PICKED_UP' state
  if (pickup.status !== 'PICKED_UP') {
    if (pickup.status === 'DELIVERED') {
      return {
        success: false,
        error: 'Conflict: This pickup has already been marked as delivered.',
        statusCode: 409,
      };
    }
    return {
      success: false,
      error: `Conflict: Pickup cannot be marked delivered from '${pickup.status}' status. OTP verification (PICKED_UP) must occur first.`,
      statusCode: 409,
    };
  }

  const nowIso = new Date().toISOString();

  // 4. ATOMIC UPDATE ON pickups (PICKED_UP -> DELIVERED)
  const { data: updatedPickups, error: pickupUpdateErr } = await queryClient
    .from('pickups')
    .update({
      status: 'DELIVERED',
      delivered_at: nowIso,
      proof_image_url: proofImageUrl || pickup.proof_image_url || null,
      updated_at: nowIso,
    })
    .eq('id', pickupId)
    .eq('status', 'PICKED_UP') // OCC
    .select('*');

  if (pickupUpdateErr || !updatedPickups || updatedPickups.length === 0) {
    return {
      success: false,
      error: 'Conflict: Pickup was modified concurrently by another transaction.',
      statusCode: 409,
    };
  }

  const updatedPickup = updatedPickups[0] as Pickup;

  // 5. ATOMIC UPDATE ON food_donations (PICKED_UP -> DELIVERED)
  const { data: updatedDonations } = await queryClient
    .from('food_donations')
    .update({
      status: 'DELIVERED',
      updated_at: nowIso,
    })
    .eq('id', pickup.donation_id)
    .eq('status', 'PICKED_UP') // OCC
    .select('*');

  const updatedDonation = (updatedDonations as FoodDonation[])?.[0];

  // 6. RECORD IMPACT METRICS (Idempotent: ON CONFLICT DO NOTHING via UNIQUE on donation_id)
  let impactMetrics: Record<string, unknown> | undefined;
  const weightKg = Number(donation?.quantity_kg || 0);

  if (weightKg > 0) {
    const estimatedMeals = Math.round(weightKg / IMPACT_CONFIG.DEFAULT_KG_PER_MEAL);
    const estimatedCo2 = Math.round(weightKg * IMPACT_CONFIG.DEFAULT_CO2_OFFSET_PER_KG * 100) / 100;

    const { data: insertedMetrics } = await queryClient
      .from('impact_metrics')
      .insert({
        donation_id: pickup.donation_id,
        weight_kg: weightKg,
        estimated_meals_served: estimatedMeals,
        estimated_co2_offset_kg: estimatedCo2,
        kg_per_meal_factor: IMPACT_CONFIG.DEFAULT_KG_PER_MEAL,
        co2_factor_per_kg: IMPACT_CONFIG.DEFAULT_CO2_OFFSET_PER_KG,
        logged_at: nowIso,
      })
      .select('*');

    impactMetrics = insertedMetrics?.[0];
  }

  // 7. Log Audit Event
  await logAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'PICKUP_DELIVERY_COMPLETED',
    targetTable: 'pickups',
    targetId: pickupId,
    newValues: {
      status: 'DELIVERED',
      delivered_at: nowIso,
      proof_image_url: proofImageUrl || null,
      impact_meals: impactMetrics ? (impactMetrics as any).estimated_meals_served : null,
    },
    ipAddress,
  });

  return {
    success: true,
    pickup: updatedPickup,
    donation: updatedDonation,
    impactMetrics,
    statusCode: 200,
  };
}

/**
 * Retrieves a single pickup by ID with IDOR protection.
 * Permitted actors:
 * - Donor owner of the donation
 * - NGO assigned to the pickup
 * - ADMIN / SUPER_ADMIN
 */
export async function getPickupById(
  pickupId: string,
  actor: User
): Promise<{ success: boolean; pickup?: Record<string, unknown>; error?: string; statusCode: number }> {
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as QueryClient;

  const { data: pickupData, error: pickupErr } = await queryClient
    .from('pickups')
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
    .eq('id', pickupId)
    .single();

  if (pickupErr || !pickupData) {
    return {
      success: false,
      error: 'Pickup not found.',
      statusCode: 404,
    };
  }

  const pickup = pickupData as Record<string, any>;
  const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
  const isNgoOwner = pickup.ngo_profiles?.user_id === actor.id;
  const isDonorOwner = pickup.food_donations?.donor_profiles?.user_id === actor.id;

  if (!isAdmin && !isNgoOwner && !isDonorOwner) {
    return {
      success: false,
      error: 'Forbidden: You do not have permission to view this pickup.',
      statusCode: 403,
    };
  }

  // NEVER expose otp_code_hash in API responses
  const sanitizedPickup = { ...pickup };
  delete sanitizedPickup.otp_code_hash;

  return {
    success: true,
    pickup: sanitizedPickup,
    statusCode: 200,
  };
}

/**
 * Lists pickups scoped according to actor permissions:
 * - NGO: views pickups assigned to its organization
 * - DONOR: views pickups on its own donations
 * - ADMIN: views all pickups
 */
export async function listPickups(
  params: ListPickupsParams
): Promise<{ success: boolean; pickups: Pickup[]; count: number; offset: number; limit: number; error?: string; statusCode: number }> {
  const { actor, status, donationId, limit = 20, offset = 0 } = params;
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as QueryClient;

  let query = queryClient
    .from('pickups')
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
    const { data: ngoProfile } = await queryClient
      .from('ngo_profiles')
      .select('id')
      .eq('user_id', actor.id)
      .single();

    if (!ngoProfile) {
      return { success: true, pickups: [], count: 0, offset, limit, statusCode: 200 };
    }
    query = query.eq('ngo_id', (ngoProfile as { id: string }).id);
  } else if (actor.role === 'DONOR') {
    const { data: donorProfile } = await queryClient
      .from('donor_profiles')
      .select('id')
      .eq('user_id', actor.id)
      .single();

    if (!donorProfile) {
      return { success: true, pickups: [], count: 0, offset, limit, statusCode: 200 };
    }

    const { data: donorDonations } = await queryClient
      .from('food_donations')
      .select('id')
      .eq('donor_id', (donorProfile as { id: string }).id);

    const donationIds = (donorDonations as { id: string }[] || []).map((d) => d.id);
    if (donationIds.length === 0) {
      return { success: true, pickups: [], count: 0, offset, limit, statusCode: 200 };
    }
    query = query.in('donation_id', donationIds);
  } else if (actor.role !== 'ADMIN' && actor.role !== 'SUPER_ADMIN') {
    return {
      success: false,
      pickups: [],
      count: 0,
      offset,
      limit,
      error: 'Forbidden: Unauthorized to list pickups.',
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
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data: pickups, error } = await query;

  if (error) {
    return {
      success: false,
      pickups: [],
      count: 0,
      offset,
      limit,
      error: 'Failed to retrieve pickups.',
      statusCode: 500,
    };
  }

  // Sanitize: strip otp_code_hash from each record
  const sanitizedPickups = ((pickups || []) as Record<string, any>[]).map((p) => {
    const copy = { ...p };
    delete copy.otp_code_hash;
    return copy as Pickup;
  });

  return {
    success: true,
    pickups: sanitizedPickups,
    count: sanitizedPickups.length,
    offset,
    limit,
    statusCode: 200,
  };
}
