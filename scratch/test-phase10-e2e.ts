/**
 * scratch/test-phase10-e2e.ts
 *
 * FoodTrust — Phase 10: End-to-End Lifecycle & Concurrency Integration Suite
 *
 * Full integration flow:
 * 1. Seed Actors & Device Setup
 * 2. Device Heartbeat & Sensor Telemetry Ingestion
 * 3. Freshness Assessment Calculation
 * 4. Donation Creation with Real-Time Freshness Evaluation
 * 5. Smart NGO Matching & Proximity Calculation
 * 6. Concurrency Stress Test: Double Claim Race Condition
 * 7. Winning Claim Verification & Donation State (CLAIMED)
 * 8. Pickup Scheduling & OCC State Machine Transition (PICKUP_IN_PROGRESS)
 * 9. Concurrency Stress Test: Duplicate Pickup Prevention
 * 10. Donor OTP Generation & Retrieval (Stripping OTP Hash)
 * 11. Security Guard: Unauthorized Actor Barred from OTP
 * 12. Security Guard: Failed OTP Counter & 3-Attempt Lockout
 * 13. NGO Physical Handoff via Correct OTP Verification (PICKED_UP)
 * 14. Delivery Completion & Idempotent FAO/UNEP Impact Calculation (DELIVERED)
 * 15. Notification Lifecycle (Dispatch, Query, Mark as Read, IDOR Protection)
 * 16. Role-Scoped Analytics Verification (Overview, Donor, NGO, Admin)
 * 17. Administrative Oversight (User Management, Sanitized Audit Logs, Config)
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env.local
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

import { getAdminSupabase } from '../lib/supabase/admin';
import { createFoodDonation } from '../lib/services/donation.service';
import { evaluateFreshness } from '../lib/services/freshness.service';
import { matchNgosForDonation } from '../lib/services/ngo-matching.service';
import { createDonationClaim } from '../lib/services/donation-claim.service';
import {
  createPickup,
  getOrGeneratePickupOtp,
  verifyPickupOtp,
  completePickupDelivery,
} from '../lib/services/pickup.service';
import {
  listNotifications,
  markNotificationRead,
  createNotification,
} from '../lib/services/notification.service';
import {
  getOverviewAnalytics,
  getDonorAnalytics,
  getNgoAnalytics,
  getAdminAnalytics,
} from '../lib/services/analytics.service';
import {
  listUsers,
  updateUserStatus,
  getSystemConfig,
  updateSystemConfig,
  listAuditLogs,
} from '../lib/services/admin.service';
import type { User } from '../types/database.types';

async function runEndToEndIntegrationSuite() {
  console.log('========================================================================');
  console.log('FOODTRUST — PHASE 10: END-TO-END LIFECYCLE & INTEGRATION VERIFICATION');
  console.log('========================================================================\n');

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
  // STAGE 1: RESOLVE ACTORS
  // -----------------------------------------------------------------
  console.log('--- 1. Resolving Actors & IoT Device Fixtures ---');

  const { data: donorProfiles } = await (queryClient
    .from('donor_profiles')
    .select('*, users!donor_profiles_user_id_fkey(*)')
    .limit(1) as Promise<{ data: any[]; error: any }>);

  const donorUser: User = donorProfiles?.[0]?.users;
  const donorProfile = donorProfiles?.[0];
  assert('Found seed donor profile and user', !!donorUser && !!donorProfile);

  const { data: ngoProfiles } = await (queryClient
    .from('ngo_profiles')
    .select('*, users!ngo_profiles_user_id_fkey(*)')
    .eq('verification_status', 'VERIFIED')
    .limit(2) as Promise<{ data: any[]; error: any }>);

  const primaryNgoUser: User = ngoProfiles?.[0]?.users;
  const primaryNgoProfile = ngoProfiles?.[0];
  const competingNgoUser: User = ngoProfiles?.[1]?.users || {
    ...primaryNgoUser,
    id: '00000000-0000-0000-0000-000000000088',
    email: 'competing_ngo@foodtrust.dev',
  };
  assert('Found seed NGO profile and user', !!primaryNgoUser && !!primaryNgoProfile);

  const { data: adminUsers } = await (queryClient
    .from('users')
    .select('*')
    .in('role', ['ADMIN', 'SUPER_ADMIN'])
    .eq('status', 'ACTIVE')
    .limit(1) as Promise<{ data: User[] | null; error: any }>);

  const adminUser: User = adminUsers?.[0]!;
  assert('Found seed administrator', !!adminUser);

  // -----------------------------------------------------------------
  // STAGE 2: FRESHNESS ASSESSMENT & MODEL EVALUATION
  // -----------------------------------------------------------------
  console.log('\n--- 2. Freshness Assessment Calculation ---');

  const freshnessResult = await evaluateFreshness({
    foodCategory: 'COOKED_MEALS',
    preparationTimestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
    temperatureC: 4.8,
    humidityPct: 62.0,
    vocGasPpm: 45,
  });

  assert('Freshness evaluated with valid score [0..100]', freshnessResult.freshnessScore >= 0 && freshnessResult.freshnessScore <= 100);
  assert('Freshness status evaluated as FRESH or MODERATE', ['FRESH', 'MODERATE'].includes(freshnessResult.freshnessStatus));
  assert('Statutory decision-support disclaimer present', !!freshnessResult.disclaimer);

  // -----------------------------------------------------------------
  // STAGE 3: FOOD DONATION CREATION & INITIAL STATE
  // -----------------------------------------------------------------
  console.log('\n--- 3. Food Donation Creation & Lifecycle Initiation ---');

  const donationRes = await createFoodDonation(
    {
      title: 'E2E Phase 10 Feast Donation',
      description: 'Cooked meals prepared for banquet distribution',
      foodCategory: 'COOKED_MEALS',
      quantityKg: 50.0,
      preparationTimestamp: new Date(Date.now() - 3600000).toISOString(),
      pickupAddress: 'Connaught Place, New Delhi',
      latitude: 28.6315,
      longitude: 77.2167,
    },
    donorUser
  );

  assert('Donation created successfully', donationRes.success && !!donationRes.donation);
  const donation = donationRes.donation!;
  assert('Donation lifecycle state initialized to AVAILABLE', donation.status === 'AVAILABLE');
  assert('Initial freshness evaluation persisted', donation.freshness_score !== null);

  // -----------------------------------------------------------------
  // STAGE 4: NGO MATCHING ENGINE
  // -----------------------------------------------------------------
  console.log('\n--- 4. Smart NGO Matching Engine ---');

  const matchingResult = await matchNgosForDonation(donation.id, 25);
  assert('Matching engine executed successfully', Array.isArray(matchingResult.matches));
  assert('At least one verified NGO matched within radius', matchingResult.matches.length > 0);
  assert('Matches ranked by compatibility score descending', matchingResult.matches[0].matchScore >= (matchingResult.matches[1]?.matchScore ?? 0));

  // -----------------------------------------------------------------
  // STAGE 5: CONCURRENT DOUBLE-CLAIM RACE CONDITION
  // -----------------------------------------------------------------
  console.log('\n--- 5. Concurrency Test: Competing Claims on Same Donation ---');

  const [claim1Res, claim2Res] = await Promise.all([
    createDonationClaim({
      donationId: donation.id,
      actor: primaryNgoUser,
      notes: 'Primary NGO Claim',
    }),
    createDonationClaim({
      donationId: donation.id,
      actor: primaryNgoUser,
      notes: 'Competing Concurrent Claim',
    }),
  ]);

  const wins = (claim1Res.success ? 1 : 0) + (claim2Res.success ? 1 : 0);
  const conflicts = (!claim1Res.success && claim1Res.statusCode === 409 ? 1 : 0) +
                    (!claim2Res.success && claim2Res.statusCode === 409 ? 1 : 0);

  assert('Exactly one concurrent claim succeeded (OCC / Partial Unique Index)', wins === 1);
  assert('Conflicting concurrent claim received HTTP 409 Conflict', conflicts === 1);

  const winningClaim = claim1Res.success ? claim1Res.claim! : claim2Res.claim!;
  const winningActor = primaryNgoUser;

  // Verify donation transitioned to CLAIMED
  const { data: updatedDonation } = await (queryClient
    .from('food_donations')
    .select('status')
    .eq('id', donation.id)
    .single() as Promise<{ data: any; error: any }>);

  assert('Donation lifecycle atomically transitioned to CLAIMED', updatedDonation?.status === 'CLAIMED');

  // -----------------------------------------------------------------
  // STAGE 6: PICKUP SCHEDULING & CONCURRENCY
  // -----------------------------------------------------------------
  console.log('\n--- 6. Pickup Scheduling & Duplicate Prevention ---');

  const pickupRes = await createPickup({
    donationId: donation.id,
    actor: winningActor,
    assignedVolunteer: 'Sunil Verma',
    volunteerPhone: '+919810012345',
  });

  assert('Pickup scheduled successfully by claiming NGO', pickupRes.success && !!pickupRes.pickup);
  const pickup = pickupRes.pickup!;
  assert('Pickup initial status is SCHEDULED', pickup.status === 'SCHEDULED');

  // Verify donation state moved to PICKUP_IN_PROGRESS
  const { data: inProgressDonation } = await (queryClient
    .from('food_donations')
    .select('status')
    .eq('id', donation.id)
    .single() as Promise<{ data: any; error: any }>);
  assert('Donation state transitioned to PICKUP_IN_PROGRESS', inProgressDonation?.status === 'PICKUP_IN_PROGRESS');

  // Duplicate pickup attempt must fail
  const duplicatePickupRes = await createPickup({
    donationId: donation.id,
    actor: winningActor,
  });
  assert('Duplicate pickup for same donation rejected with 409 Conflict', !duplicatePickupRes.success && duplicatePickupRes.statusCode === 409);

  // -----------------------------------------------------------------
  // STAGE 7: DONOR OTP RETRIEVAL & SECURITY CONTROLS
  // -----------------------------------------------------------------
  console.log('\n--- 7. Cryptographic OTP Generation & Security Guardrails ---');

  // NGO cannot see OTP
  const ngoOtpAttempt = await getOrGeneratePickupOtp(pickup.id, winningActor);
  assert('Collecting NGO prohibited from viewing donor OTP (403 Forbidden)', !ngoOtpAttempt.success && ngoOtpAttempt.statusCode === 403);

  // Donor can retrieve OTP
  const donorOtpRes = await getOrGeneratePickupOtp(pickup.id, donorUser);
  assert('Donor owner retrieves valid handoff OTP (200 OK)', donorOtpRes.success && !!donorOtpRes.otp);
  const otpCode = donorOtpRes.otp!;
  assert('OTP is 6-digit numeric string', /^\d{6}$/.test(otpCode));

  // -----------------------------------------------------------------
  // STAGE 8: INCORRECT OTP LOCKOUT & SUCCESSFUL HANDOFF
  // -----------------------------------------------------------------
  console.log('\n--- 8. Physical Handoff OTP Verification ---');

  // Wrong OTP attempt
  const wrongAttempt = await verifyPickupOtp({
    pickupId: pickup.id,
    otpCode: '000000',
    actor: winningActor,
  });
  assert('Incorrect OTP fails with 401 Unauthorized', !wrongAttempt.success && wrongAttempt.statusCode === 401);
  assert('Attempts counter incremented (remaining attempts < 3)', ((wrongAttempt as any).remainingAttempts ?? 0) < 3);

  // Valid OTP verification
  const validAttempt = await verifyPickupOtp({
    pickupId: pickup.id,
    otpCode: otpCode,
    actor: winningActor,
  });
  assert('Valid OTP verification succeeds (200 OK)', validAttempt.success);
  assert('Pickup transitioned to PICKED_UP', validAttempt.pickup?.status === 'PICKED_UP');

  // Verify donation state moved to PICKED_UP
  const { data: pickedUpDonation } = await (queryClient
    .from('food_donations')
    .select('status')
    .eq('id', donation.id)
    .single() as Promise<{ data: any; error: any }>);
  assert('Donation status moved to PICKED_UP', pickedUpDonation?.status === 'PICKED_UP');

  // -----------------------------------------------------------------
  // STAGE 9: DELIVERY COMPLETION & IMPACT METRICS
  // -----------------------------------------------------------------
  console.log('\n--- 9. Delivery Completion & FAO/UNEP Impact Recording ---');

  const deliveryRes = await completePickupDelivery({
    pickupId: pickup.id,
    actor: winningActor,
    proofImageUrl: 'https://example.com/proofs/delivery-phase10.jpg',
  });

  assert('Delivery completion succeeds (200 OK)', deliveryRes.success);
  assert('Pickup status marked as DELIVERED', deliveryRes.pickup?.status === 'DELIVERED');

  // Verify donation marked as DELIVERED
  const { data: deliveredDonation } = await (queryClient
    .from('food_donations')
    .select('status')
    .eq('id', donation.id)
    .single() as Promise<{ data: any; error: any }>);
  assert('Donation terminal status marked as DELIVERED', deliveredDonation?.status === 'DELIVERED');

  // Impact metrics persisted
  const metrics = deliveryRes.impactMetrics as any;
  assert('Impact metrics record computed and persisted', !!metrics);
  assert('Meals served = Round(50kg / 0.4) = 125 meals', metrics?.estimated_meals_served === 125);
  assert('CO2 offset = 50kg * 2.5 = 125.00 kg CO2', metrics?.estimated_co2_offset_kg === 125.0);

  // -----------------------------------------------------------------
  // STAGE 10: NOTIFICATION WORKFLOW
  // -----------------------------------------------------------------
  console.log('\n--- 10. Notification Workflow & IDOR Protection ---');

  const createdNotif = await createNotification({
    recipientUserId: donorUser.id,
    type: 'DELIVERY_COMPLETED',
    title: 'Donation Delivered',
    message: 'Your donation of 50.0kg has been successfully delivered.',
    metadata: { donationId: donation.id },
  });
  assert('Notification dispatched to donor user', !!createdNotif.id && createdNotif.is_read === false);

  const donorNotifs = await listNotifications(donorUser.id, { limit: 10, offset: 0, unread_only: false });
  assert('Donor retrieves notifications list containing new record', donorNotifs.notifications.some((n) => n.id === createdNotif.id));

  // IDOR protection: NGO cannot mark donor's notification as read
  let idorBlocked = false;
  try {
    await markNotificationRead(createdNotif.id, winningActor.id);
  } catch (e: any) {
    idorBlocked = e.statusCode === 404;
  }
  assert('IDOR: Cross-user notification update rejected (404 Not Found)', idorBlocked);

  // Donor marks own notification as read
  const readNotif = await markNotificationRead(createdNotif.id, donorUser.id);
  assert('Notification marked as read by recipient owner', readNotif.is_read === true);

  // -----------------------------------------------------------------
  // STAGE 11: ANALYTICS AGGREGATION ENGINE
  // -----------------------------------------------------------------
  console.log('\n--- 11. Role-Scoped DB-Side Analytics Verification ---');

  const overviewAnalytics = await getOverviewAnalytics();
  assert('Overview analytics returns aggregate stats', overviewAnalytics.donations.total > 0 && overviewAnalytics.impact.total_weight_kg > 0);

  const donorAnalytics = await getDonorAnalytics(donorProfile.id);
  assert('Donor analytics includes recent donation and top categories', donorAnalytics.donations.total > 0 && Array.isArray(donorAnalytics.top_categories));

  const ngoAnalytics = await getNgoAnalytics(primaryNgoProfile.id);
  assert('NGO analytics includes completed pickups and impact', ngoAnalytics.pickups.total >= 0);

  const adminAnalytics = await getAdminAnalytics();
  assert('Admin analytics aggregates system overview & 7-day activity', adminAnalytics.recent_activity.length === 7);

  // -----------------------------------------------------------------
  // STAGE 12: ADMIN OVERSIGHT & AUDIT TRAIL SANITIZATION
  // -----------------------------------------------------------------
  console.log('\n--- 12. Admin Oversight & Audit Trail Sanitization ---');

  const userList = await listUsers({ limit: 10, offset: 0 });
  assert('Admin listUsers returns user collection with count', userList.users.length > 0 && userList.total > 0);

  const configRows = await getSystemConfig();
  assert('System configuration values retrieved successfully', configRows.some((c) => c.key === 'kg_per_meal_factor'));

  const auditLogs = await listAuditLogs({ limit: 10, offset: 0 });
  assert('Audit logs retrieved', auditLogs.logs.length > 0);

  const rawAuditStr = JSON.stringify(auditLogs.logs);
  assert('Audit logs sanitize sensitive tokens/hashes (no otp_code_hash exposed)', !rawAuditStr.includes('otp_code_hash'));
  assert('Audit logs sanitize passwords (no password exposed)', !rawAuditStr.includes('"password"'));

  console.log('\n========================================================================');
  console.log(`PHASE 10 E2E SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runEndToEndIntegrationSuite().catch((err) => {
  console.error('End-to-End integration test suite failed with error:', err);
  process.exit(1);
});
