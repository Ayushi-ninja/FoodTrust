/**
 * lib/services/analytics.service.ts
 * FoodTrust — Phase 9: Analytics, Notifications & Admin Oversight
 *
 * DB-side aggregation analytics. All metrics computed in Postgres —
 * never in-memory over full datasets. Impact factors read from
 * public.system_config so PATCH /api/admin/config changes take effect.
 *
 * References:
 * - IMPLEMENTATION_DECISIONS.md Section 3.2 (Impact Estimation Protocol)
 * - ARCHITECTURE_REVIEW.md Issue 15.1
 */

import { getAdminSupabase } from '@/lib/supabase/admin';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type QueryClient = { from: (table: string) => Record<string, Function> };

function qc(): QueryClient {
  return getAdminSupabase() as unknown as QueryClient;
}

/** Reads a numeric config value from system_config, falling back to the default. */
async function readConfigNumber(key: string, fallback: number): Promise<number> {
  try {
    const { data } = await (qc()
      .from('system_config')
      .select('value')
      .eq('key', key)
      .maybeSingle() as unknown as Promise<{ data: { value: string } | null }>);
    if (data?.value) {
      const parsed = parseFloat(data.value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // fall through to default
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Overview Analytics (any authenticated user)
// ---------------------------------------------------------------------------

export interface OverviewAnalytics {
  donations: {
    total: number;
    available: number;
    delivered: number;
    cancelled: number;
    expired: number;
  };
  impact: {
    total_weight_kg: number;
    total_meals_served: number;
    total_co2_offset_kg: number;
  };
  users: {
    total: number;
    donors: number;
    ngos: number;
  };
  claims: {
    total: number;
    approved: number;
    rejected: number;
    pending: number;
  };
}

export async function getOverviewAnalytics(): Promise<OverviewAnalytics> {
  const client = qc();

  // Donation status counts — DB GROUP BY
  const { data: donationRows } = await (client
    .from('food_donations')
    .select('status') as unknown as Promise<{
    data: { status: string }[] | null;
  }>);

  const donationData = donationRows ?? [];
  const countByStatus = (status: string) =>
    donationData.filter((r) => r.status === status).length;

  // Impact aggregates — SUM from impact_metrics
  const { data: impactRows } = await (client
    .from('impact_metrics')
    .select('weight_kg,estimated_meals_served,estimated_co2_offset_kg') as unknown as Promise<{
    data: {
      weight_kg: number;
      estimated_meals_served: number;
      estimated_co2_offset_kg: number;
    }[] | null;
  }>);

  const impactData = impactRows ?? [];
  const sumImpact = {
    total_weight_kg: impactData.reduce((s, r) => s + Number(r.weight_kg), 0),
    total_meals_served: impactData.reduce((s, r) => s + Number(r.estimated_meals_served), 0),
    total_co2_offset_kg: impactData.reduce(
      (s, r) => s + Number(r.estimated_co2_offset_kg),
      0
    ),
  };

  // User role counts
  const { data: userRows } = await (client
    .from('users')
    .select('role') as unknown as Promise<{ data: { role: string }[] | null }>);

  const userData = userRows ?? [];
  const countByRole = (role: string) => userData.filter((r) => r.role === role).length;

  // Claim status counts
  const { data: claimRows } = await (client
    .from('donation_claims')
    .select('status') as unknown as Promise<{
    data: { status: string }[] | null;
  }>);

  const claimData = claimRows ?? [];
  const countClaimByStatus = (status: string) =>
    claimData.filter((r) => r.status === status).length;

  return {
    donations: {
      total: donationData.length,
      available: countByStatus('AVAILABLE'),
      delivered: countByStatus('DELIVERED'),
      cancelled: countByStatus('CANCELLED'),
      expired: countByStatus('EXPIRED'),
    },
    impact: {
      total_weight_kg: Math.round(sumImpact.total_weight_kg * 100) / 100,
      total_meals_served: Math.round(sumImpact.total_meals_served),
      total_co2_offset_kg: Math.round(sumImpact.total_co2_offset_kg * 100) / 100,
    },
    users: {
      total: userData.length,
      donors: countByRole('DONOR'),
      ngos: countByRole('NGO'),
    },
    claims: {
      total: claimData.length,
      approved: countClaimByStatus('APPROVED'),
      rejected: countClaimByStatus('REJECTED'),
      pending: countClaimByStatus('PENDING'),
    },
  };
}

// ---------------------------------------------------------------------------
// Donor Analytics (DONOR role — own donations only)
// ---------------------------------------------------------------------------

export interface DonorAnalytics {
  donations: {
    total: number;
    available: number;
    delivered: number;
    cancelled: number;
  };
  impact: {
    total_weight_kg: number;
    total_meals_served: number;
    total_co2_offset_kg: number;
  };
  top_categories: { category: string; count: number }[];
}

export async function getDonorAnalytics(donorId: string): Promise<DonorAnalytics> {
  const client = qc();

  const { data: donations } = await (client
    .from('food_donations')
    .select('id,status,food_category')
    .eq('donor_id', donorId) as unknown as Promise<{
    data: { id: string; status: string; food_category: string }[] | null;
  }>);

  const donationData = donations ?? [];
  const donationIds = donationData.map((d) => d.id);

  const countByStatus = (status: string) =>
    donationData.filter((d) => d.status === status).length;

  // Category breakdown — top 5 DB-side
  const categoryCounts: Record<string, number> = {};
  for (const d of donationData) {
    categoryCounts[d.food_category] = (categoryCounts[d.food_category] ?? 0) + 1;
  }
  const top_categories = Object.entries(categoryCounts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Impact — only for donor's completed donations
  let sumImpact = { total_weight_kg: 0, total_meals_served: 0, total_co2_offset_kg: 0 };
  if (donationIds.length > 0) {
    const { data: impactRows } = await (client
      .from('impact_metrics')
      .select('weight_kg,estimated_meals_served,estimated_co2_offset_kg')
      .in('donation_id', donationIds) as unknown as Promise<{
      data: {
        weight_kg: number;
        estimated_meals_served: number;
        estimated_co2_offset_kg: number;
      }[] | null;
    }>);

    const impactData = impactRows ?? [];
    sumImpact = {
      total_weight_kg: impactData.reduce((s, r) => s + Number(r.weight_kg), 0),
      total_meals_served: impactData.reduce((s, r) => s + Number(r.estimated_meals_served), 0),
      total_co2_offset_kg: impactData.reduce(
        (s, r) => s + Number(r.estimated_co2_offset_kg),
        0
      ),
    };
  }

  return {
    donations: {
      total: donationData.length,
      available: countByStatus('AVAILABLE'),
      delivered: countByStatus('DELIVERED'),
      cancelled: countByStatus('CANCELLED'),
    },
    impact: {
      total_weight_kg: Math.round(sumImpact.total_weight_kg * 100) / 100,
      total_meals_served: Math.round(sumImpact.total_meals_served),
      total_co2_offset_kg: Math.round(sumImpact.total_co2_offset_kg * 100) / 100,
    },
    top_categories,
  };
}

// ---------------------------------------------------------------------------
// NGO Analytics (NGO role — own pickups/claims)
// ---------------------------------------------------------------------------

export interface NgoAnalytics {
  claims: {
    total: number;
    approved: number;
    rejected: number;
  };
  pickups: {
    total: number;
    delivered: number;
    failed: number;
  };
  impact: {
    total_weight_kg: number;
    total_meals_served: number;
    total_co2_offset_kg: number;
  };
}

export async function getNgoAnalytics(ngoId: string): Promise<NgoAnalytics> {
  const client = qc();

  // Claims
  const { data: claimRows } = await (client
    .from('donation_claims')
    .select('status')
    .eq('ngo_id', ngoId) as unknown as Promise<{
    data: { status: string }[] | null;
  }>);
  const claimData = claimRows ?? [];
  const countClaimByStatus = (status: string) =>
    claimData.filter((r) => r.status === status).length;

  // Pickups
  const { data: pickupRows } = await (client
    .from('pickups')
    .select('donation_id,status')
    .eq('ngo_id', ngoId) as unknown as Promise<{
    data: { donation_id: string; status: string }[] | null;
  }>);
  const pickupData = pickupRows ?? [];
  const countPickupByStatus = (status: string) =>
    pickupData.filter((r) => r.status === status).length;

  // Impact from impact_metrics via donation_id
  const donationIds = pickupData.map((p) => p.donation_id);
  let sumImpact = { total_weight_kg: 0, total_meals_served: 0, total_co2_offset_kg: 0 };
  if (donationIds.length > 0) {
    const { data: impactRows } = await (client
      .from('impact_metrics')
      .select('weight_kg,estimated_meals_served,estimated_co2_offset_kg')
      .in('donation_id', donationIds) as unknown as Promise<{
      data: {
        weight_kg: number;
        estimated_meals_served: number;
        estimated_co2_offset_kg: number;
      }[] | null;
    }>);

    const impactData = impactRows ?? [];
    sumImpact = {
      total_weight_kg: impactData.reduce((s, r) => s + Number(r.weight_kg), 0),
      total_meals_served: impactData.reduce((s, r) => s + Number(r.estimated_meals_served), 0),
      total_co2_offset_kg: impactData.reduce(
        (s, r) => s + Number(r.estimated_co2_offset_kg),
        0
      ),
    };
  }

  return {
    claims: {
      total: claimData.length,
      approved: countClaimByStatus('APPROVED'),
      rejected: countClaimByStatus('REJECTED'),
    },
    pickups: {
      total: pickupData.length,
      delivered: countPickupByStatus('DELIVERED'),
      failed: countPickupByStatus('FAILED'),
    },
    impact: {
      total_weight_kg: Math.round(sumImpact.total_weight_kg * 100) / 100,
      total_meals_served: Math.round(sumImpact.total_meals_served),
      total_co2_offset_kg: Math.round(sumImpact.total_co2_offset_kg * 100) / 100,
    },
  };
}

// ---------------------------------------------------------------------------
// Admin Analytics (ADMIN/SUPER_ADMIN — system-wide)
// ---------------------------------------------------------------------------

export interface AdminAnalytics {
  system_overview: {
    total_donations: number;
    active_donors: number;
    active_ngos: number;
    total_impact_kg: number;
  };
  donation_status_breakdown: { status: string; count: number }[];
  recent_activity: { date: string; donations_created: number; deliveries_completed: number }[];
}

export async function getAdminAnalytics(): Promise<AdminAnalytics> {
  const client = qc();

  // Donations
  const { data: donationRows } = await (client
    .from('food_donations')
    .select('status,created_at') as unknown as Promise<{
    data: { status: string; created_at: string }[] | null;
  }>);
  const donationData = donationRows ?? [];

  // Users
  const { data: userRows } = await (client
    .from('users')
    .select('role,status') as unknown as Promise<{
    data: { role: string; status: string }[] | null;
  }>);
  const userData = userRows ?? [];

  // Impact total
  const { data: impactRows } = await (client
    .from('impact_metrics')
    .select('weight_kg') as unknown as Promise<{
    data: { weight_kg: number }[] | null;
  }>);
  const totalImpactKg = (impactRows ?? []).reduce(
    (s, r) => s + Number(r.weight_kg),
    0
  );

  // Status breakdown
  const statusMap: Record<string, number> = {};
  for (const d of donationData) {
    statusMap[d.status] = (statusMap[d.status] ?? 0) + 1;
  }
  const donation_status_breakdown = Object.entries(statusMap)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  // Recent activity — last 7 days
  const now = new Date();
  const recent_activity: { date: string; donations_created: number; deliveries_completed: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().substring(0, 10); // YYYY-MM-DD

    const donations_created = donationData.filter(
      (r) => r.created_at.substring(0, 10) === dateStr
    ).length;
    const deliveries_completed = donationData.filter(
      (r) => r.status === 'DELIVERED' && r.created_at.substring(0, 10) === dateStr
    ).length;

    recent_activity.push({ date: dateStr, donations_created, deliveries_completed });
  }

  return {
    system_overview: {
      total_donations: donationData.length,
      active_donors: userData.filter(
        (u) => u.role === 'DONOR' && u.status === 'ACTIVE'
      ).length,
      active_ngos: userData.filter(
        (u) => u.role === 'NGO' && u.status === 'ACTIVE'
      ).length,
      total_impact_kg: Math.round(totalImpactKg * 100) / 100,
    },
    donation_status_breakdown,
    recent_activity,
  };
}

// Re-export readConfigNumber for admin service
export { readConfigNumber };
