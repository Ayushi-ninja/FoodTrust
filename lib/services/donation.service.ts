/**
 * lib/services/donation.service.ts
 * FoodTrust — Phase 6: Food Donation Lifecycle Management
 *
 * Centralized business logic for food donation creation, updates, and retrieval.
 */

import { getAdminSupabase } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { evaluateFreshness } from '@/lib/services/freshness.service';
import { logAuditEvent } from '@/lib/services/audit.service';
import type { CreateDonationInput, UpdateDonationInput } from '@/lib/validation/donation.schema';
import type { FoodDonation, User } from '@/types/database.types';

export interface CreateDonationResult {
  success: boolean;
  donation?: FoodDonation;
  error?: string;
  statusCode?: number;
}

export interface UpdateDonationResult {
  success: boolean;
  donation?: FoodDonation;
  error?: string;
  statusCode?: number;
}

/**
 * Creates a new food donation record linked to the authenticated donor.
 * Integrates Phase 4 freshness service for initial freshness evaluation.
 */
export async function createFoodDonation(
  input: CreateDonationInput,
  actor: User,
  ipAddress?: string
): Promise<CreateDonationResult> {
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as {
    from: (table: string) => Record<string, Function>;
  };

  // 1. Verify user role: Only DONOR can create food donations
  if (actor.role !== 'DONOR') {
    return {
      success: false,
      error: 'Forbidden: Only registered donors can submit food donations.',
      statusCode: 403,
    };
  }

  // 2. Resolve donor profile ID from user ID
  const { data: donorProfile, error: donorError } = await queryClient
    .from('donor_profiles')
    .select('id')
    .eq('user_id', actor.id)
    .single();

  if (donorError || !donorProfile) {
    return {
      success: false,
      error: 'Donor profile not found for authenticated user.',
      statusCode: 404,
    };
  }

  const donorId = (donorProfile as { id: string }).id;

  // 3. Initial Freshness Evaluation via Phase 4 Freshness Service
  // Standard initial ambient assumptions (22°C ambient room, 55% humidity, 50 ppm clean air)
  // when sensors are not attached or at manual donation submission
  const nowIso = new Date().toISOString();
  const freshnessEval = evaluateFreshness({
    foodCategory: input.foodCategory,
    preparationTimestamp: input.preparationTimestamp,
    evaluationTimestamp: nowIso,
    temperatureC: 22.0,
    humidityPct: 55.0,
    vocGasPpm: 50.0,
  });

  // 4. Insert donation record atomically
  const { data: insertedRows, error: insertError } = await queryClient
    .from('food_donations')
    .insert({
      donor_id: donorId,
      bin_id: input.binId || null,
      tray_id: input.trayId || null,
      title: input.title,
      description: input.description || null,
      food_category: input.foodCategory,
      quantity_kg: input.quantityKg,
      preparation_timestamp: input.preparationTimestamp,
      freshness_score: freshnessEval.freshnessScore,
      freshness_status: freshnessEval.freshnessStatus,
      risk_level: freshnessEval.riskLevel,
      shelf_life_hours_remaining: freshnessEval.estimatedShelfLifeHours,
      status: 'AVAILABLE',
      pickup_address: input.pickupAddress,
      latitude: input.latitude,
      longitude: input.longitude,
      image_url: input.imageUrl || null,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select('*');

  if (insertError) {
    return {
      success: false,
      error: 'Failed to create food donation record.',
      statusCode: 500,
    };
  }

  const donation = (insertedRows as FoodDonation[])?.[0];

  // 5. Append initial snapshot to freshness_logs
  if (donation) {
    try {
      await queryClient.from('freshness_logs').insert({
        donation_id: donation.id,
        evaluated_score: freshnessEval.freshnessScore,
        freshness_status: freshnessEval.freshnessStatus,
        risk_level: freshnessEval.riskLevel,
        shelf_life_hours: freshnessEval.estimatedShelfLifeHours,
        gas_reading_ppm: freshnessEval.vocGasPpm,
        temperature_c: freshnessEval.temperatureC,
        humidity_pct: freshnessEval.humidityPct,
        evaluated_at: nowIso,
      });
    } catch (logErr) {
      console.error('Failed to log initial freshness record:', logErr);
    }

    // 6. Append audit log
    await logAuditEvent({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'DONATION_CREATED',
      targetTable: 'food_donations',
      targetId: donation.id,
      newValues: {
        title: donation.title,
        category: donation.food_category,
        quantityKg: donation.quantity_kg,
        status: donation.status,
      },
      ipAddress,
    });
  }

  return {
    success: true,
    donation,
    statusCode: 201,
  };
}

/**
 * Updates mutable fields of an existing donation.
 * Strictly verifies that the donation is in an editable state (AVAILABLE)
 * and that the caller is the legitimate owner.
 */
export async function updateFoodDonation(
  donationId: string,
  updates: UpdateDonationInput,
  actor: User,
  ipAddress?: string
): Promise<UpdateDonationResult> {
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as {
    from: (table: string) => Record<string, Function>;
  };

  // 1. Fetch existing donation with donor ownership
  const { data: existingData, error: fetchError } = await queryClient
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

  if (fetchError || !existingData) {
    return {
      success: false,
      error: 'Donation not found.',
      statusCode: 404,
    };
  }

  const donation = existingData as FoodDonation & {
    donor_profiles: { id: string; user_id: string };
  };

  // 2. IDOR Ownership Check
  const isOwner = donation.donor_profiles?.user_id === actor.id;
  const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';

  if (!isOwner && !isAdmin) {
    return {
      success: false,
      error: 'Forbidden: You do not have permission to modify this donation.',
      statusCode: 403,
    };
  }

  // 3. State Check: Only donations in AVAILABLE status can be edited
  if (donation.status !== 'AVAILABLE') {
    return {
      success: false,
      error: `Conflict: Donations in '${donation.status}' status cannot be modified. Only 'AVAILABLE' donations may be edited.`,
      statusCode: 409,
    };
  }

  // 4. Prepare update payload (mapping camelCase to snake_case)
  const dbUpdates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.title !== undefined) dbUpdates.title = updates.title;
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.foodCategory !== undefined) dbUpdates.food_category = updates.foodCategory;
  if (updates.quantityKg !== undefined) dbUpdates.quantity_kg = updates.quantityKg;
  if (updates.pickupAddress !== undefined) dbUpdates.pickup_address = updates.pickupAddress;
  if (updates.latitude !== undefined) dbUpdates.latitude = updates.latitude;
  if (updates.longitude !== undefined) dbUpdates.longitude = updates.longitude;
  if (updates.imageUrl !== undefined) dbUpdates.image_url = updates.imageUrl;

  // 5. Execute atomic update
  const { data: updatedRows, error: updateError } = await queryClient
    .from('food_donations')
    .update(dbUpdates)
    .eq('id', donationId)
    .eq('status', 'AVAILABLE') // OCC check
    .select('*');

  if (updateError) {
    return {
      success: false,
      error: 'Failed to update food donation record.',
      statusCode: 500,
    };
  }

  const updatedDonation = (updatedRows as FoodDonation[])?.[0];
  if (!updatedDonation) {
    return {
      success: false,
      error: 'Conflict: Donation status was modified concurrently by another process.',
      statusCode: 409,
    };
  }

  // 6. Append audit log
  await logAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'DONATION_UPDATED',
    targetTable: 'food_donations',
    targetId: donationId,
    oldValues: {
      title: donation.title,
      quantityKg: donation.quantity_kg,
    },
    newValues: dbUpdates,
    ipAddress,
  });

  return {
    success: true,
    donation: updatedDonation,
    statusCode: 200,
  };
}
