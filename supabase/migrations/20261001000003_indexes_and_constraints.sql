-- =============================================================================
-- Migration: 20261001000003_indexes_and_constraints.sql
-- Project:   FoodTrust — AI + IoT Smart Food Waste Monitoring & Redistribution
-- Phase:     Phase 1 — Database Foundation
-- Step:      3 of 5 — Indexes & Additional Constraints
--
-- PREREQUISITES: 20261001000002_core_tables.sql must be applied first.
--
-- References:
--   IMPLEMENTATION_DECISIONS.md Section 2.3 (PostGIS Spatial Structure)
--   IMPLEMENTATION_DECISIONS.md Section 2.4 (Race-Condition Prevention)
--   ARCHITECTURE_REVIEW.md      Issue 5.1  (Tray composite unique)
--   ARCHITECTURE_REVIEW.md      Issue 5.3  (Donation claim partial unique index)
--   ARCHITECTURE_REVIEW.md      Issue 13.1 (Spatial GIST index)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CRITICAL: Partial Unique Index — Donation Claim Race-Condition Prevention
--
-- Enforces that at most ONE active (APPROVED or PENDING) claim can exist
-- per donation at the database engine level.
-- This is the primary mechanism preventing double-claiming when two NGOs
-- simultaneously claim the same donation.
-- The claim API route additionally uses SELECT FOR UPDATE inside a transaction.
--
-- Ref: IMPLEMENTATION_DECISIONS.md Section 2.4
--      ARCHITECTURE_REVIEW.md Issue 5.3
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_claim
  ON public.donation_claims (donation_id)
  WHERE status IN ('APPROVED', 'PENDING');

COMMENT ON INDEX idx_single_active_claim IS
  'Partial unique index. Enforces at most one APPROVED or PENDING claim per donation. Primary race-condition prevention mechanism.';

-- ---------------------------------------------------------------------------
-- 2. PostGIS Spatial GIST Indexes
--    Required for ST_DWithin and ST_Distance queries to perform efficiently.
--    Without GIST, spatial queries degrade to O(n) sequential scans.
--    Ref: IMPLEMENTATION_DECISIONS.md Section 2.3
--         ARCHITECTURE_REVIEW.md Issue 13.1
-- ---------------------------------------------------------------------------

-- NGO location index: primary lookup target in the NGO matching engine
CREATE INDEX IF NOT EXISTS idx_ngo_location
  ON public.ngo_profiles USING GIST (location);

-- Donor location index: used in admin geographic analytics / heatmaps
CREATE INDEX IF NOT EXISTS idx_donor_location
  ON public.donor_profiles USING GIST (location);

-- Donation pickup location index: used when querying nearby available donations
CREATE INDEX IF NOT EXISTS idx_donation_location
  ON public.food_donations USING GIST (location);

-- ---------------------------------------------------------------------------
-- 3. sensor_telemetry Time-Series Indexes
--    High-frequency writes — reads are always filtered by bin_id + time range.
--    Composite index (bin_id, recorded_at DESC) matches the most common query
--    pattern: "give me the latest N readings for bin X".
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_telemetry_bin_time
  ON public.sensor_telemetry (bin_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_tray_time
  ON public.sensor_telemetry (tray_id, recorded_at DESC)
  WHERE tray_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. food_donations Lookup Indexes
--    Most common API query patterns against the donations table.
-- ---------------------------------------------------------------------------

-- Status filter: GET /api/donations?status=AVAILABLE
CREATE INDEX IF NOT EXISTS idx_donations_status
  ON public.food_donations (status);

-- Donor-specific donations: GET /api/analytics/donor
CREATE INDEX IF NOT EXISTS idx_donations_donor
  ON public.food_donations (donor_id, created_at DESC);

-- Category + status compound: GET /api/donations?category=COOKED_MEALS&status=AVAILABLE
CREATE INDEX IF NOT EXISTS idx_donations_category_status
  ON public.food_donations (food_category, status);

-- Bin-linked donations: retrieve donations auto-created from a specific bin
CREATE INDEX IF NOT EXISTS idx_donations_bin
  ON public.food_donations (bin_id)
  WHERE bin_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. donation_claims Lookup Indexes
-- ---------------------------------------------------------------------------

-- All claims for a specific donation (claim history)
CREATE INDEX IF NOT EXISTS idx_claims_donation
  ON public.donation_claims (donation_id, claimed_at DESC);

-- All claims submitted by a specific NGO
CREATE INDEX IF NOT EXISTS idx_claims_ngo
  ON public.donation_claims (ngo_id, claimed_at DESC);

-- ---------------------------------------------------------------------------
-- 6. pickups Lookup Indexes
-- ---------------------------------------------------------------------------

-- NGO-scoped pickup list: GET /api/pickups for NGO role
CREATE INDEX IF NOT EXISTS idx_pickups_ngo_status
  ON public.pickups (ngo_id, status);

-- Status filter for admin dashboard
CREATE INDEX IF NOT EXISTS idx_pickups_status
  ON public.pickups (status);

-- ---------------------------------------------------------------------------
-- 7. freshness_logs Time-Series Index
--    Queries always reference a specific donation ordered by evaluation time.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_freshness_donation_time
  ON public.freshness_logs (donation_id, evaluated_at DESC);

-- ---------------------------------------------------------------------------
-- 8. notifications Inbox Indexes
--    Inbox queries: all unread notifications for a user, ordered by recency.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON public.notifications (recipient_user_id, created_at DESC)
  WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_all
  ON public.notifications (recipient_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 9. audit_logs Query Indexes
--    Admin audit trail queries: filtered by actor, action type, or target table.
-- ---------------------------------------------------------------------------

-- Filter by actor (admin reviewing a user's actions)
CREATE INDEX IF NOT EXISTS idx_audit_actor
  ON public.audit_logs (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

-- Filter by action type (e.g., 'CLAIM_DONATION' across all actors)
CREATE INDEX IF NOT EXISTS idx_audit_action
  ON public.audit_logs (action, created_at DESC);

-- Filter by target table (e.g., all changes to 'smart_bins')
CREATE INDEX IF NOT EXISTS idx_audit_target_table
  ON public.audit_logs (target_table, created_at DESC);

-- ---------------------------------------------------------------------------
-- 10. smart_bins Lookup Indexes
-- ---------------------------------------------------------------------------

-- Donor-owned bins: GET /api/iot/bins for DONOR role
CREATE INDEX IF NOT EXISTS idx_bins_donor
  ON public.smart_bins (donor_id);

-- Status filter: admin queries for OFFLINE or ALERT bins
CREATE INDEX IF NOT EXISTS idx_bins_status
  ON public.smart_bins (status);

-- ---------------------------------------------------------------------------
-- 11. users Lookup Indexes
-- ---------------------------------------------------------------------------

-- Role-based filtering: admin user management
CREATE INDEX IF NOT EXISTS idx_users_role
  ON public.users (role);

-- Status filter: suspended/pending users
CREATE INDEX IF NOT EXISTS idx_users_status
  ON public.users (status);

-- impact_metrics donor join (via food_donations.donor_id → analytics)
CREATE INDEX IF NOT EXISTS idx_impact_donation
  ON public.impact_metrics (donation_id);

-- =============================================================================
-- END: 20261001000003_indexes_and_constraints.sql
-- =============================================================================
