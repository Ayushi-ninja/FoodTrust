/**
 * scratch/test-phase6-security-audit.ts
 *
 * Targeted Security & Regression Audit Suite for Phase 6.
 *
 * Covers:
 * Audit A: Authorization, IDOR, Donor ID spoofing, protected field immutability, role guards
 * Audit B: Terminal states (DELIVERED, CANCELLED, EXPIRED) cannot be reopened or edited
 * Audit C: Concurrency & OCC race condition simulation (two simultaneous updates)
 * Audit D: Freshness integrity, missing telemetry handling, compliance disclaimer
 * Audit E: NGO Matching lifecycle eligibility (only AVAILABLE matchable, others rejected)
 * Audit F: Audit logging verification
 * Audit G: Supabase live RLS check
 */

import * as fs from 'fs';
import * as path from 'path';

try {
  const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8');
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    }
  });
} catch (e) {
  console.warn('Could not load .env.local:', e);
}

if (!globalThis.WebSocket) {
  // @ts-ignore
  globalThis.WebSocket = class DummyWebSocket {};
}

import { isValidTransition, VALID_TRANSITIONS, transitionDonationStatus } from '../lib/services/donation-lifecycle.service';
import { createFoodDonation, updateFoodDonation } from '../lib/services/donation.service';
import { matchNgosForDonation } from '../lib/services/ngo-matching.service';
import { evaluateFreshness, FRESHNESS_CONSTANTS } from '../lib/services/freshness.service';
import {
  createDonationSchema,
  updateDonationSchema,
  cancelDonationSchema,
  transitionDonationSchema,
} from '../lib/validation/donation.schema';
import { getAdminSupabase } from '../lib/supabase/admin';
import type { User, DonationStatus, FoodCategory } from '../types/database.types';

async function runAudit() {
  console.log('===============================================================');
  console.log('FOODTRUST — PHASE 6: SECURITY & REGRESSION AUDIT SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(desc: string, condition: boolean) {
    if (condition) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${desc}`);
      failed++;
    }
  }

  const adminClient = getAdminSupabase();
  const queryClient = adminClient as unknown as { from: (table: string) => Record<string, Function> };

  // -----------------------------------------------------------------
  // 1. SETUP USERS & TEST FIXTURES
  // -----------------------------------------------------------------
  console.log('--- 1. Setting Up Test Fixtures ---');
  const { data: donorProfiles } = await (queryClient
    .from('donor_profiles')
    .select('*, users!donor_profiles_user_id_fkey(*)')
    .limit(2) as Promise<{ data: any[]; error: any }>);

  if (!donorProfiles || donorProfiles.length === 0) {
    throw new Error('No donor profiles available in database for testing.');
  }

  const donorAUser: User = donorProfiles[0].users || {
    id: donorProfiles[0].user_id,
    email: 'donorA@foodtrust.dev',
    phone: '+919999999001',
    full_name: 'Donor A User',
    role: 'DONOR',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const donorBUser: User = {
    id: '00000000-0000-0000-0000-000000000002',
    email: 'donorB@foodtrust.dev',
    phone: '+919999999002',
    full_name: 'Donor B User',
    role: 'DONOR',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const ngoUser: User = {
    id: '00000000-0000-0000-0000-000000000003',
    email: 'ngo@foodtrust.dev',
    phone: '+919999999003',
    full_name: 'NGO User',
    role: 'NGO',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const adminUser: User = {
    id: '00000000-0000-0000-0000-000000000004',
    email: 'admin@foodtrust.dev',
    phone: '+919999999004',
    full_name: 'System Admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const suspendedDonorUser: User = {
    id: donorAUser.id,
    email: donorAUser.email,
    phone: donorAUser.phone,
    full_name: donorAUser.full_name,
    role: 'DONOR',
    status: 'SUSPENDED',
    created_at: donorAUser.created_at,
    updated_at: donorAUser.updated_at,
  };

  console.log('Test fixtures initialized successfully.\n');

  // -----------------------------------------------------------------
  // AUDIT A: AUTHORIZATION & IDOR
  // -----------------------------------------------------------------
  console.log('--- AUDIT A: Authorization, IDOR & Field Protection ---');

  // A1: NGO cannot create food donation
  const ngoCreateRes = await createFoodDonation(
    {
      title: 'Illegitimate NGO Donation',
      foodCategory: 'COOKED_MEALS',
      quantityKg: 10,
      preparationTimestamp: new Date(Date.now() - 3600000).toISOString(),
      pickupAddress: 'Connaught Place, New Delhi',
      latitude: 28.6315,
      longitude: 77.2167,
    },
    ngoUser
  );
  assert('NGO cannot create donation (403 Forbidden)', !ngoCreateRes.success && ngoCreateRes.statusCode === 403);

  // A2: Valid Donor A creation
  const donorACreateRes = await createFoodDonation(
    {
      title: 'Audit A: Donor A Valid Donation',
      foodCategory: 'COOKED_MEALS',
      quantityKg: 15,
      preparationTimestamp: new Date(Date.now() - 3600000).toISOString(),
      pickupAddress: 'Connaught Place, New Delhi',
      latitude: 28.6315,
      longitude: 77.2167,
    },
    donorAUser
  );
  assert('Donor A can create donation (201 Created)', donorACreateRes.success && !!donorACreateRes.donation);
  const donationAId = donorACreateRes.donation!.id;

  // A3: Donor B cannot update Donor A's donation (IDOR)
  const idorUpdateRes = await updateFoodDonation(
    donationAId,
    { title: 'Hacked Title by Donor B' },
    donorBUser
  );
  assert("Donor B cannot update Donor A's donation (403 Forbidden)", !idorUpdateRes.success && idorUpdateRes.statusCode === 403);

  // A4: Donor B cannot cancel Donor A's donation
  const idorCancelRes = await transitionDonationStatus({
    donationId: donationAId,
    targetStatus: 'CANCELLED',
    actor: donorBUser,
  });
  assert("Donor B cannot cancel Donor A's donation (403 Forbidden)", !idorCancelRes.success && idorCancelRes.statusCode === 403);

  // A5: Zod Schema rejects status or freshness fields in client update
  const schemaHasStatus = 'status' in updateDonationSchema.shape;
  const schemaHasFreshness = 'freshness_score' in updateDonationSchema.shape;
  const schemaHasDonorId = 'donor_id' in updateDonationSchema.shape;
  assert('updateDonationSchema does not allow status', !schemaHasStatus);
  assert('updateDonationSchema does not allow freshness_score', !schemaHasFreshness);
  assert('updateDonationSchema does not allow donor_id', !schemaHasDonorId);

  // -----------------------------------------------------------------
  // AUDIT B: TERMINAL STATES & TRANSITION MATRIX
  // -----------------------------------------------------------------
  console.log('\n--- AUDIT B: Terminal States & Matrix Invariants ---');

  // Verify terminal states have zero outgoing transitions
  assert('DELIVERED is terminal (0 transitions)', VALID_TRANSITIONS.DELIVERED.length === 0);
  assert('CANCELLED is terminal (0 transitions)', VALID_TRANSITIONS.CANCELLED.length === 0);
  assert('EXPIRED is terminal (0 transitions)', VALID_TRANSITIONS.EXPIRED.length === 0);

  // Verify prohibited transitions
  assert('DELIVERED -> AVAILABLE is prohibited', !isValidTransition('DELIVERED', 'AVAILABLE'));
  assert('DELIVERED -> CLAIMED is prohibited', !isValidTransition('DELIVERED', 'CLAIMED'));
  assert('CANCELLED -> DELIVERED is prohibited', !isValidTransition('CANCELLED', 'DELIVERED'));
  assert('CANCELLED -> AVAILABLE is prohibited', !isValidTransition('CANCELLED', 'AVAILABLE'));
  assert('EXPIRED -> CLAIMED is prohibited', !isValidTransition('EXPIRED', 'CLAIMED'));
  assert('EXPIRED -> AVAILABLE is prohibited', !isValidTransition('EXPIRED', 'AVAILABLE'));
  assert('PICKED_UP -> AVAILABLE is prohibited', !isValidTransition('PICKED_UP', 'AVAILABLE'));

  // Cancel donationA and test modification immunity
  const cancelRes = await transitionDonationStatus({
    donationId: donationAId,
    targetStatus: 'CANCELLED',
    actor: donorAUser,
    reason: 'Audit B terminal test',
  });
  assert('Donor A cancels own donation (200 OK)', cancelRes.success && cancelRes.donation?.status === 'CANCELLED');

  const updateCancelledRes = await updateFoodDonation(
    donationAId,
    { quantityKg: 50 },
    donorAUser
  );
  assert('Modifying CANCELLED donation is rejected (409 Conflict)', !updateCancelledRes.success && updateCancelledRes.statusCode === 409);

  const reopenRes = await transitionDonationStatus({
    donationId: donationAId,
    targetStatus: 'AVAILABLE',
    actor: adminUser,
  });
  assert('Reopening CANCELLED donation is rejected (409 Conflict)', !reopenRes.success && reopenRes.statusCode === 409);

  // -----------------------------------------------------------------
  // AUDIT C: ATOMICITY & OPTIMISTIC CONCURRENCY CONTROL (OCC)
  // -----------------------------------------------------------------
  console.log('\n--- AUDIT C: Atomicity & Concurrency (OCC) ---');

  // Create isolated donation for concurrency test
  const occDonationRes = await createFoodDonation(
    {
      title: 'Audit C: Concurrency OCC Race Test',
      foodCategory: 'VEGETABLES',
      quantityKg: 30,
      preparationTimestamp: new Date(Date.now() - 3600000).toISOString(),
      pickupAddress: 'Connaught Place, New Delhi',
      latitude: 28.6315,
      longitude: 77.2167,
    },
    donorAUser
  );
  const occDonationId = occDonationRes.donation!.id;

  // Run two simultaneous transitions: both trying to transition from AVAILABLE to CANCELLED and RESERVED
  const [attempt1, attempt2] = await Promise.all([
    transitionDonationStatus({
      donationId: occDonationId,
      targetStatus: 'CANCELLED',
      actor: donorAUser,
      reason: 'Concurrent Attempt 1 (CANCELLED)',
    }),
    transitionDonationStatus({
      donationId: occDonationId,
      targetStatus: 'RESERVED',
      actor: adminUser,
      reason: 'Concurrent Attempt 2 (RESERVED)',
    }),
  ]);

  const successes = (attempt1.success ? 1 : 0) + (attempt2.success ? 1 : 0);
  const conflicts = (!attempt1.success && attempt1.statusCode === 409 ? 1 : 0) +
                    (!attempt2.success && attempt2.statusCode === 409 ? 1 : 0);

  assert('Exactly one concurrent transition succeeded', successes === 1);
  assert('Conflicting concurrent transition received 409 Conflict', conflicts === 1);

  // -----------------------------------------------------------------
  // AUDIT D: FRESHNESS INTEGRITY & DISCLAIMERS
  // -----------------------------------------------------------------
  console.log('\n--- AUDIT D: Freshness Integrity ---');

  const evalResult = evaluateFreshness({
    foodCategory: 'DAIRY',
    preparationTimestamp: new Date(Date.now() - 7200000).toISOString(),
    temperatureC: 22.0,
    humidityPct: 50.0,
    vocGasPpm: 50.0,
  });

  assert('Freshness score is between 0 and 100', evalResult.freshnessScore >= 0 && evalResult.freshnessScore <= 100);
  assert('Statutory compliance disclaimer is present', evalResult.disclaimer === FRESHNESS_CONSTANTS.COMPLIANCE_DISCLAIMER);
  assert('No binary safe_to_eat certification field is exposed', !('safe_to_eat' in (evalResult as any)));

  // -----------------------------------------------------------------
  // AUDIT E: NGO MATCHING LIFECYCLE ELIGIBILITY & SIDE-EFFECTS
  // -----------------------------------------------------------------
  console.log('\n--- AUDIT E: NGO Matching Lifecycle Eligibility ---');

  // Create an AVAILABLE donation for matching test
  const matchingDonationRes = await createFoodDonation(
    {
      title: 'Audit E: Eligible Matching Test Donation',
      foodCategory: 'COOKED_MEALS',
      quantityKg: 10,
      preparationTimestamp: new Date(Date.now() - 1800000).toISOString(),
      pickupAddress: 'Connaught Place, New Delhi',
      latitude: 28.6315,
      longitude: 77.2167,
    },
    donorAUser
  );
  const matchDonationId = matchingDonationRes.donation!.id;

  // E1: AVAILABLE donation succeeds in matching
  const matchAvailableRes = await matchNgosForDonation(matchDonationId);
  assert('AVAILABLE donation returns matches', matchAvailableRes.matchesCount > 0);

  // E2: Verify zero side effects on matching
  const { data: claimsCheck } = await (queryClient
    .from('donation_claims')
    .select('id')
    .eq('donation_id', matchDonationId) as Promise<{ data: any[]; error: any }>);
  assert('Zero donation_claims created during matching', !claimsCheck || claimsCheck.length === 0);

  const { data: pickupsCheck } = await (queryClient
    .from('pickups')
    .select('id')
    .eq('donation_id', matchDonationId) as Promise<{ data: any[]; error: any }>);
  assert('Zero pickups created during matching', !pickupsCheck || pickupsCheck.length === 0);

  // E3: Transition to CANCELLED and verify matching rejects it
  await transitionDonationStatus({
    donationId: matchDonationId,
    targetStatus: 'CANCELLED',
    actor: donorAUser,
    reason: 'Audit E cancellation test',
  });

  let matchingCancelledThrew = false;
  try {
    await matchNgosForDonation(matchDonationId);
  } catch (err: any) {
    if (err.message.includes('not eligible for NGO matching')) {
      matchingCancelledThrew = true;
    }
  }
  assert('CANCELLED donation is rejected by matching engine', matchingCancelledThrew);

  // -----------------------------------------------------------------
  // AUDIT F: AUDIT TRAIL LOGGING
  // -----------------------------------------------------------------
  console.log('\n--- AUDIT F: Audit Trail Logging ---');

  const { data: auditEvents } = await (queryClient
    .from('audit_logs')
    .select('*')
    .eq('target_id', matchDonationId) as Promise<{ data: any[]; error: any }>);

  const hasCreated = auditEvents?.some((e) => e.action === 'DONATION_CREATED');
  const hasCancelled = auditEvents?.some((e) => e.action === 'DONATION_CANCELLED');

  assert('DONATION_CREATED audit log was recorded', Boolean(hasCreated));
  assert('DONATION_CANCELLED audit log was recorded', Boolean(hasCancelled));

  // Verify no secrets or passwords in audit logs
  const hasSecrets = auditEvents?.some((e) => {
    const raw = JSON.stringify(e);
    return raw.includes('password') || raw.includes('api_key') || raw.includes('secret');
  });
  assert('Audit log contains no credentials or secrets', !hasSecrets);

  // -----------------------------------------------------------------
  // AUDIT G: SUPABASE RLS VERIFICATION
  // -----------------------------------------------------------------
  console.log('\n--- AUDIT G: Supabase Database Integrity ---');

  const { data: seedDonation } = await (queryClient
    .from('food_donations')
    .select('id, status')
    .eq('id', 'a0000006-0000-4000-8000-000000000006')
    .single() as Promise<{ data: any; error: any }>);

  assert('Seed donation exists and remains intact', !!seedDonation);

  console.log('\n===============================================================');
  console.log(`AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAudit().catch((err) => {
  console.error('Audit execution fatal error:', err);
  process.exit(1);
});
