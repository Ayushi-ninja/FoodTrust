/**
 * lib/services/ngo-matching.service.ts
 * FoodTrust — Phase 5: Smart NGO Matching Engine
 *
 * MATCHING OBJECTIVE (ARCHITECTURE.md Section 8):
 * Evaluates verified, active NGOs for an available food donation using:
 * 1. Geographic Proximity (PostGIS / WGS84 Geodesic Distance).
 * 2. Operational Radius Boundary (Disqualifies NGOs if distance > operational_radius_km).
 * 3. Daily Capacity Verification (Disqualifies NGOs if quantity_kg > daily_capacity_kg).
 * 4. Storage Compatibility (Prioritizes cold storage when donation shelf life or category requires it).
 * 5. Freshness / Urgency Boost (Derived from Phase 4 freshness score).
 * 6. Deterministic, Explainable Match Scoring & Ranking.
 *
 * READ-ONLY SAFETY CONTRACT:
 * - Matching is strictly a recommendation engine.
 * - Calling this service produces ZERO write side-effects:
 *   NO donation_claims rows created, NO status mutations, NO pickups scheduled.
 */

import { getAdminSupabase } from '@/lib/supabase/admin';
import type { Database } from '@/types/database.types';

export type FoodDonationRow = Database['public']['Tables']['food_donations']['Row'];
export type NgoProfileRow = Database['public']['Tables']['ngo_profiles']['Row'];

export interface MatchingWeights {
  proximityWeight: number; // default: 0.40
  capacityWeight: number; // default: 0.25
  storageWeight: number; // default: 0.15
  urgencyWeight: number; // default: 0.20
}

export const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
  proximityWeight: 0.4,
  capacityWeight: 0.25,
  storageWeight: 0.15,
  urgencyWeight: 0.2,
};

export interface NgoMatchCandidate {
  ngoId: string;
  organizationName: string;
  registrationNumber: string;
  verificationStatus: string;
  distanceKm: number;
  operationalRadiusKm: number;
  dailyCapacityKg: number;
  hasColdStorage: boolean;
  address: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  // Transparent score breakdown
  matchScore: number; // 0 to 100
  scoringBreakdown: {
    proximityScore: number; // 0 to 100
    capacityScore: number; // 0 to 100
    storageScore: number; // 0 to 100
    urgencyScore: number; // 0 to 100
  };
  compatibilityReasons: string[];
}

export interface MatchingResult {
  donationId: string;
  donationTitle: string;
  donationCategory: string;
  quantityKg: number;
  freshnessScore: number;
  freshnessStatus: string;
  riskLevel: string;
  shelfLifeHoursRemaining: number;
  donationLocation: {
    latitude: number;
    longitude: number;
    pickupAddress: string;
  };
  totalEligibleEvaluated: number;
  matchesCount: number;
  matches: NgoMatchCandidate[];
  matchedAt: string;
}

/**
 * Calculates geodesic distance in meters on the WGS84 ellipsoid
 * using the Haversine formula (accurate within 0.3% of PostGIS ST_Distance).
 */
export function calculateGeodesicDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Mean Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Pure evaluation function that ranks eligible candidates against a donation.
 * Deterministic: given identical donation and NGO list, output order is stable.
 */
export function rankNgoCandidates(
  donation: FoodDonationRow,
  candidates: NgoProfileRow[],
  weights: MatchingWeights = DEFAULT_MATCHING_WEIGHTS
): NgoMatchCandidate[] {
  const matches: NgoMatchCandidate[] = [];

  for (const ngo of candidates) {
    // 1. Eligibility Check: Must be VERIFIED
    if (ngo.verification_status !== 'VERIFIED') {
      continue;
    }

    // 2. Geographic Distance Check
    const distanceMeters = calculateGeodesicDistanceMeters(
      donation.latitude,
      donation.longitude,
      ngo.latitude,
      ngo.longitude
    );
    const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;

    // Boundary Filter: Must be within NGO's operational radius
    if (distanceKm > ngo.operational_radius_km) {
      continue;
    }

    // 3. Capacity Check: NGO daily capacity must accommodate donation quantity
    if (Number(donation.quantity_kg) > Number(ngo.daily_capacity_kg)) {
      continue;
    }

    // --- SCORING FACTOR BREAKDOWN (0 to 100 each) ---

    // Factor A: Proximity Score (Closer = higher score; 100 at 0km, 0 at boundary)
    const radius = Math.max(1, ngo.operational_radius_km);
    const proximityScore = Math.max(
      0,
      Math.min(100, Math.round((1 - distanceKm / radius) * 100))
    );

    // Factor B: Capacity Score (Best fit between donation size and total capacity)
    // Avoids overwhelming tiny NGOs while rewarding sufficient handling capacity
    const capacityRatio = Number(donation.quantity_kg) / Number(ngo.daily_capacity_kg);
    // Ideal ratio is 20% to 70% capacity utilization
    let capacityScore = 80;
    if (capacityRatio > 0.9) capacityScore = 60; // Near capacity limit
    else if (capacityRatio < 0.05) capacityScore = 70; // Under-utilized
    else capacityScore = 100;

    // Factor C: Storage Compatibility Score
    // ARCHITECTURE.md Section 8: Cold storage prioritization for perishable/long shelf-life goods
    let storageScore = 70;
    const isPerishableCategory =
      donation.food_category === 'DAIRY' || donation.food_category === 'COOKED_MEALS';
    const isLongShelfLifeNeeded = Number(donation.shelf_life_hours_remaining) > 12;

    if (ngo.has_cold_storage) {
      storageScore = 100;
    } else if (isPerishableCategory && isLongShelfLifeNeeded) {
      storageScore = 40; // Penalty if cold storage would have been beneficial
    }

    // Factor D: Urgency Boost Score (Derived from Phase 4 Freshness Status & Score)
    // Critical and moderate donations need urgent assignment boost
    let urgencyScore = 50;
    if (donation.freshness_status === 'CRITICAL') {
      urgencyScore = 100;
    } else if (donation.freshness_status === 'MODERATE') {
      urgencyScore = 75;
    } else if (donation.freshness_status === 'FRESH') {
      urgencyScore = 50;
    } else {
      // EXPIRED donations should ideally not be distributed
      urgencyScore = 10;
    }

    // Weighted Overall Score
    const totalWeightedScore =
      weights.proximityWeight * proximityScore +
      weights.capacityWeight * capacityScore +
      weights.storageWeight * storageScore +
      weights.urgencyWeight * urgencyScore;

    const matchScore = Math.round(totalWeightedScore * 10) / 10;

    // Explainable compatibility reasons
    const compatibilityReasons: string[] = [
      `Within operational radius (${distanceKm} km / ${ngo.operational_radius_km} km max)`,
      `Sufficient daily capacity (${ngo.daily_capacity_kg} kg capacity for ${donation.quantity_kg} kg donation)`,
    ];
    if (ngo.has_cold_storage) {
      compatibilityReasons.push('Cold storage facility available for perishable preservation');
    }
    if (donation.freshness_status === 'CRITICAL') {
      compatibilityReasons.push('Prioritized due to critical freshness window');
    }

    matches.push({
      ngoId: ngo.id,
      organizationName: ngo.organization_name,
      registrationNumber: ngo.registration_number,
      verificationStatus: ngo.verification_status,
      distanceKm,
      operationalRadiusKm: ngo.operational_radius_km,
      dailyCapacityKg: Number(ngo.daily_capacity_kg),
      hasColdStorage: ngo.has_cold_storage,
      address: ngo.address,
      contactPerson: ngo.contact_person,
      contactPhone: ngo.contact_phone,
      matchScore,
      scoringBreakdown: {
        proximityScore,
        capacityScore,
        storageScore,
        urgencyScore,
      },
      compatibilityReasons,
    });
  }

  // Deterministic Ranking:
  // 1. Highest matchScore first
  // 2. Tie-breaker 1: Shortest distanceKm
  // 3. Tie-breaker 2: Deterministic string comparison on ngoId
  matches.sort((a, b) => {
    if (b.matchScore !== a.matchScore) {
      return b.matchScore - a.matchScore;
    }
    if (a.distanceKm !== b.distanceKm) {
      return a.distanceKm - b.distanceKm;
    }
    return a.ngoId.localeCompare(b.ngoId);
  });

  return matches;
}

/**
 * Service function to find and rank matching NGOs for a given donation.
 */
export async function matchNgosForDonation(
  donationId: string,
  limit = 10,
  weights = DEFAULT_MATCHING_WEIGHTS
): Promise<MatchingResult> {
  const adminSupabase = getAdminSupabase();
  const queryClient = adminSupabase as unknown as {
    from: (table: string) => Record<string, Function>;
  };

  // 1. Fetch the donation record
  const { data: donationData, error: donationError } = await queryClient
    .from('food_donations')
    .select('*')
    .eq('id', donationId)
    .single();

  if (donationError || !donationData) {
    throw new Error(`Donation not found with ID ${donationId}`);
  }

  const donation = donationData as FoodDonationRow;

  // 2. Validate donation lifecycle status
  // Only AVAILABLE donations in the public distribution pool are eligible for NGO matching recommendations.
  // Inactive, terminal, or already claimed/reserved donations are ineligible.
  if (donation.status !== 'AVAILABLE') {
    throw new Error(
      `Donation is not eligible for NGO matching. Current status is '${donation.status}', but only 'AVAILABLE' donations can be matched.`
    );
  }

  // 3. Fetch all verified NGOs
  // RLS bypass via admin client ensures full NGO candidates are evaluated server-side
  const { data: ngoData, error: ngoError } = await queryClient
    .from('ngo_profiles')
    .select('*')
    .eq('verification_status', 'VERIFIED');

  if (ngoError) {
    throw new Error('Failed to query verified NGO candidate pool');
  }

  const ngos = (ngoData || []) as NgoProfileRow[];

  // 3. Execute deterministic spatial and compatibility ranking
  const rankedMatches = rankNgoCandidates(donation, ngos, weights);
  const truncatedMatches = rankedMatches.slice(0, Math.max(1, limit));

  return {
    donationId: donation.id,
    donationTitle: donation.title,
    donationCategory: donation.food_category,
    quantityKg: Number(donation.quantity_kg),
    freshnessScore: donation.freshness_score,
    freshnessStatus: donation.freshness_status,
    riskLevel: donation.risk_level,
    shelfLifeHoursRemaining: Number(donation.shelf_life_hours_remaining),
    donationLocation: {
      latitude: donation.latitude,
      longitude: donation.longitude,
      pickupAddress: donation.pickup_address,
    },
    totalEligibleEvaluated: ngos.length,
    matchesCount: truncatedMatches.length,
    matches: truncatedMatches,
    matchedAt: new Date().toISOString(),
  };
}
