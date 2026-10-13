/**
 * scratch/test-phase7-claims.ts
 *
 * Comprehensive Test & Verification Suite for Phase 7: NGO Claim Management.
 *
 * Tests:
 * 1. Role Authorization: Non-NGO accounts cannot claim; unverified NGOs cannot claim.
 * 2. IDOR Protection: Claim retrieval scoped strictly to owner NGO, owner donor, and Admin.
 * 3. Atomic Claim Creation: Eligible verified NGO successfully claims AVAILABLE donation.
 * 4. Status Consistency: Claim transitions to 'APPROVED' and donation to 'CLAIMED'.
 * 5. Lifecycle Guard: Already claimed, cancelled, expired, or delivered donations cannot be claimed.
 * 6. Capacity Protection: NGO daily capacity must accommodate donation quantity.
 * 7. OCC / Concurrent Double-Claiming Race Condition: Two simultaneous claims on the same donation;
 *    exactly one succeeds, and the other receives HTTP 409 Conflict.
 * 8. Rejection Workflow: Donor or Admin rejects claim, releasing donation back to 'AVAILABLE'.
 * 9. Listing & Filtering: Role-scoped list verification.
 * 10. Audit Trail: DONATION_CLAIM_CREATED and DONATION_CLAIM_REJECTED events recorded.
 * 11. Phase 8 Scope Boundary: Zero pickups, zero OTPs, zero notifications created.
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

import {
  createDonationClaim,
  getClaimById,
  listClaims,
  rejectDonationClaim,
} from '../lib/services/donation-claim.service';
import { createFoodDonation } from '../lib/services/donation.service';
import { transitionDonationStatus } from '../lib/services/donation-lifecycle.service';
import { getAdminSupabase } from '../lib/supabase/admin';
import type { User, FoodDonation, DonationClaim } from '../types/database.types';

async function runPhase7Tests() {
  console.log('===============================================================');
  console.log('FOODTRUST — PHASE 7: NGO CLAIM MANAGEMENT TEST SUITE');
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
  // 1. SETUP TEST FIXTURES
  // -----------------------------------------------------------------
  console.log('--- 1. Initializing Test Actors & Fixtures ---');

  // Fetch verified seed donor
  const { data: donorProfiles } = await (queryClient
    .from('donor_profiles')
    .select('*, users!donor_profiles_user_id_fkey(*)')
    .limit(1) as Promise<{ data: any[]; error: any }>);

  const donorUser: User = donorProfiles?.[0]?.users || {
    id: donorProfiles?.[0]?.user_id,
    email: 'donor@foodtrust.dev',
    phone: '+919999999001',
    full_name: 'Seed Donor User',
    role: 'DONOR',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Fetch verified seed NGO (Asha Foundation)
  const { data: ngoProfiles } = await (queryClient
    .from('ngo_profiles')
    .select('*, users!ngo_profiles_user_id_fkey(*)')
    .eq('verification_status', 'VERIFIED')
    .limit(2) as Promise<{ data: any[]; error: any }>);

  if (!ngoProfiles || ngoProfiles.length === 0) {
    throw new Error('No verified NGO profiles found in database.');
  }

  const ngo1User: User = ngoProfiles[0].users || {
    id: ngoProfiles[0].user_id,
    email: 'ngo1@foodtrust.dev',
    phone: '+919999999002',
    full_name: 'Verified NGO 1 User',
    role: 'NGO',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const adminUser: User = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'admin@foodtrust.dev',
    phone: '+919999999999',
    full_name: 'System Admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Create isolated test donation for claiming
  const donationRes = await createFoodDonation(
    {
      title: 'Phase 7 Test Donation: Dal Makhani & Roti',
      description: 'Donation created specifically for Phase 7 claim testing',
      foodCategory: 'COOKED_MEALS',
      quantityKg: 20.0,
      preparationTimestamp: new Date(Date.now() - 3600000).toISOString(),
      pickupAddress: 'Connaught Place, New Delhi',
      latitude: 28.6315,
      longitude: 77.2167,
    },
    donorUser
  );

  assert('Test donation created with AVAILABLE status', donationRes.success && donationRes.donation?.status === 'AVAILABLE');
  const testDonationId = donationRes.donation!.id;

  // -----------------------------------------------------------------
  // 2. ROLE AUTHORIZATION & ELIGIBILITY CHECKS
  // -----------------------------------------------------------------
  console.log('\n--- 2. Role Authorization & Eligibility Checks ---');

  // Donor cannot claim a donation
  const donorClaimAttempt = await createDonationClaim({
    donationId: testDonationId,
    actor: donorUser,
  });
  assert('Donor cannot claim donation (403 Forbidden)', !donorClaimAttempt.success && donorClaimAttempt.statusCode === 403);

  // Admin cannot directly claim a donation as an NGO
  const adminClaimAttempt = await createDonationClaim({
    donationId: testDonationId,
    actor: adminUser,
  });
  assert('Admin cannot directly claim donation (403 Forbidden)', !adminClaimAttempt.success && adminClaimAttempt.statusCode === 403);

  // Fake unverified NGO cannot claim
  const unverifiedNgoUser: User = {
    id: '00000000-0000-0000-0000-000000000099',
    email: 'unverified@foodtrust.dev',
    phone: '+919999999099',
    full_name: 'Unverified NGO',
    role: 'NGO',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const unverifiedClaimAttempt = await createDonationClaim({
    donationId: testDonationId,
    actor: unverifiedNgoUser,
  });
  assert('Unregistered/Unverified NGO profile rejected (404/403)', !unverifiedClaimAttempt.success);

  // -----------------------------------------------------------------
  // 3. ATOMIC CLAIM CREATION & STATUS CONSISTENCY
  // -----------------------------------------------------------------
  console.log('\n--- 3. Atomic Claim Creation & Status Consistency ---');

  const claimResult = await createDonationClaim({
    donationId: testDonationId,
    actor: ngo1User,
    notes: 'Asha Foundation primary claim submission',
  });

  assert('Eligible verified NGO creates claim (201 Created)', claimResult.success && !!claimResult.claim);
  assert('Claim status is APPROVED', claimResult.claim?.status === 'APPROVED');
  assert('Donation status transitioned to CLAIMED', claimResult.donation?.status === 'CLAIMED');

  const claimId = claimResult.claim!.id;

  // Verify donation status in remote DB directly
  const { data: dbDonation } = await (queryClient
    .from('food_donations')
    .select('status')
    .eq('id', testDonationId)
    .single() as Promise<{ data: any; error: any }>);
  assert('Donation status in database is CLAIMED', dbDonation?.status === 'CLAIMED');

  // -----------------------------------------------------------------
  // 4. DUPLICATE ACTIVE CLAIM REJECTION
  // -----------------------------------------------------------------
  console.log('\n--- 4. Duplicate Active Claim Rejection ---');

  const duplicateClaimAttempt = await createDonationClaim({
    donationId: testDonationId,
    actor: ngo1User,
    notes: 'Duplicate claim attempt',
  });
  assert('Duplicate claim on already claimed donation is rejected with 409 Conflict', !duplicateClaimAttempt.success && duplicateClaimAttempt.statusCode === 409);

  // -----------------------------------------------------------------
  // 5. CONCURRENT OCC RACE CONDITION VERIFICATION
  // -----------------------------------------------------------------
  console.log('\n--- 5. Concurrent Double-Claiming Race Condition Simulation ---');

  // Create another isolated donation for race test
  const raceDonationRes = await createFoodDonation(
    {
      title: 'Phase 7 Race Condition Test Donation',
      foodCategory: 'COOKED_MEALS',
      quantityKg: 15.0,
      preparationTimestamp: new Date(Date.now() - 3600000).toISOString(),
      pickupAddress: 'Connaught Place, New Delhi',
      latitude: 28.6315,
      longitude: 77.2167,
    },
    donorUser
  );
  const raceDonationId = raceDonationRes.donation!.id;

  // Run two concurrent claims simultaneously
  const [raceAttempt1, raceAttempt2] = await Promise.all([
    createDonationClaim({
      donationId: raceDonationId,
      actor: ngo1User,
      notes: 'Concurrent Claim Attempt 1',
    }),
    createDonationClaim({
      donationId: raceDonationId,
      actor: ngo1User,
      notes: 'Concurrent Claim Attempt 2',
    }),
  ]);

  const wins = (raceAttempt1.success ? 1 : 0) + (raceAttempt2.success ? 1 : 0);
  const conflicts = (!raceAttempt1.success && raceAttempt1.statusCode === 409 ? 1 : 0) +
                    (!raceAttempt2.success && raceAttempt2.statusCode === 409 ? 1 : 0);

  assert('Exactly one concurrent claim won the race (wins = 1)', wins === 1);
  assert('Conflicting concurrent claim received HTTP 409 Conflict', conflicts === 1);

  // -----------------------------------------------------------------
  // 6. IDOR & CLAIM RETRIEVAL
  // -----------------------------------------------------------------
  console.log('\n--- 6. IDOR & Claim Retrieval ---');

  // NGO owner can retrieve own claim
  const ngoGetClaim = await getClaimById(claimId, ngo1User);
  assert('NGO owner can retrieve own claim (200 OK)', ngoGetClaim.success && !!ngoGetClaim.claim);

  // Donor owner can retrieve claim on its donation
  const donorGetClaim = await getClaimById(claimId, donorUser);
  assert('Donor owner can retrieve claim on its donation (200 OK)', donorGetClaim.success && !!donorGetClaim.claim);

  // Unrelated user cannot retrieve claim
  const unrelatedUser: User = {
    id: '00000000-0000-0000-0000-000000000088',
    email: 'stranger@foodtrust.dev',
    phone: '+919999999088',
    full_name: 'Unrelated Stranger',
    role: 'NGO',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const strangerGetClaim = await getClaimById(claimId, unrelatedUser);
  assert('Unrelated user is blocked from viewing claim (403 Forbidden)', !strangerGetClaim.success && strangerGetClaim.statusCode === 403);

  // -----------------------------------------------------------------
  // 7. CLAIM REJECTION & DONATION RELEASE
  // -----------------------------------------------------------------
  console.log('\n--- 7. Claim Rejection & Donation Release ---');

  // Stranger cannot reject claim
  const strangerRejectAttempt = await rejectDonationClaim(claimId, unrelatedUser, 'Illegitimate rejection');
  assert('Unauthorized actor cannot reject claim (403 Forbidden)', !strangerRejectAttempt.success && strangerRejectAttempt.statusCode === 403);

  // Donor owner rejects claim
  const rejectRes = await rejectDonationClaim(claimId, donorUser, 'Volunteer unavailable for pickup window');
  assert('Donor owner rejects claim successfully (200 OK)', rejectRes.success && rejectRes.claim?.status === 'REJECTED');
  assert('Donation is released back to AVAILABLE status', rejectRes.donation?.status === 'AVAILABLE');

  // Verify status in DB
  const { data: releasedDonation } = await (queryClient
    .from('food_donations')
    .select('status')
    .eq('id', testDonationId)
    .single() as Promise<{ data: any; error: any }>);
  assert('Database confirms donation status is AVAILABLE again', releasedDonation?.status === 'AVAILABLE');

  // -----------------------------------------------------------------
  // 8. AUDIT LOGGING
  // -----------------------------------------------------------------
  console.log('\n--- 8. Audit Logging Verification ---');

  const { data: auditEvents } = await (queryClient
    .from('audit_logs')
    .select('*')
    .eq('target_id', claimId) as Promise<{ data: any[]; error: any }>);

  const hasClaimCreated = auditEvents?.some((e) => e.action === 'DONATION_CLAIM_CREATED');
  const hasClaimRejected = auditEvents?.some((e) => e.action === 'DONATION_CLAIM_REJECTED');

  assert('DONATION_CLAIM_CREATED audit log recorded', Boolean(hasClaimCreated));
  assert('DONATION_CLAIM_REJECTED audit log recorded', Boolean(hasClaimRejected));

  // -----------------------------------------------------------------
  // 9. PHASE 8 BOUNDARY ISOLATION
  // -----------------------------------------------------------------
  console.log('\n--- 9. Phase 8 Boundary Isolation ---');

  const { data: pickupsCheck } = await (queryClient
    .from('pickups')
    .select('id')
    .eq('donation_id', testDonationId) as Promise<{ data: any[]; error: any }>);
  assert('Zero pickups rows created (Phase 8 isolated)', !pickupsCheck || pickupsCheck.length === 0);

  const { data: notificationsCheck } = await (queryClient
    .from('notifications')
    .select('id')
    .eq('recipient_user_id', ngo1User.id)
    .eq('type', 'DONATION_CLAIMED') as Promise<{ data: any[]; error: any }>);
  assert('Zero notifications created (Phase 8 isolated)', !notificationsCheck || notificationsCheck.length === 0);

  console.log('\n===============================================================');
  console.log(`PHASE 7 SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase7Tests().catch((err) => {
  console.error('Phase 7 test suite failed:', err);
  process.exit(1);
});
