-- =============================================================================
-- Migration: 20261001000005_rls_policies.sql
-- Project:   FoodTrust — AI + IoT Smart Food Waste Monitoring & Redistribution
-- Phase:     Phase 1 — Database Foundation
-- Step:      5 of 5 — Row Level Security Policies
--
-- PREREQUISITES: 20261001000004_triggers_and_functions.sql must be applied first.
--
-- Security model summary:
--   - DONOR  : Can view/edit their own profile, bins, trays, donations
--   - NGO    : Can view verified NGO list, available donations, claim donations,
--               view their own pickups and claim history
--   - ADMIN  : Full read/write across all application tables
--   - SUPER_ADMIN : Same as ADMIN (role checked the same way)
--   - DEVICE : No direct Supabase client access (uses service role in API handler)
--   - Unauthenticated : No access to any table
--
-- CRITICAL: get_current_user_role() uses SECURITY DEFINER to avoid the
-- recursive RLS query trap that would occur if we queried public.users
-- inside a policy on public.users itself.
-- Ref: ARCHITECTURE_REVIEW.md Issue 8.1
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. HELPER FUNCTION: get_current_user_role()
--
-- Returns the role of the currently authenticated user by looking up
-- public.users WHERE id = auth.uid(). Uses SECURITY DEFINER so the
-- lookup executes with superuser privileges, bypassing RLS on users table
-- and preventing an infinite recursive policy evaluation loop.
--
-- Usage in policies: get_current_user_role() = 'ADMIN'
--
-- Ref: IMPLEMENTATION_DECISIONS.md Section 5.1
--      ARCHITECTURE_REVIEW.md Issue 8.1
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS user_role_enum
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role user_role_enum;
BEGIN
  SELECT role INTO v_role
  FROM public.users
  WHERE id = auth.uid();

  RETURN v_role;
END;
$$;

COMMENT ON FUNCTION public.get_current_user_role() IS
  'SECURITY DEFINER: Returns the user_role_enum of the currently authenticated user. Used in RLS policies to prevent recursive policy evaluation on the users table.';

-- ---------------------------------------------------------------------------
-- 2. HELPER FUNCTION: is_admin()
--    Convenience predicate used in policies: returns TRUE for ADMIN/SUPER_ADMIN.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN get_current_user_role() IN ('ADMIN', 'SUPER_ADMIN');
END;
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'Convenience SECURITY DEFINER function. Returns TRUE if current user has ADMIN or SUPER_ADMIN role.';

-- ---------------------------------------------------------------------------
-- 3. HELPER FUNCTION: get_donor_profile_id()
--    Returns the donor_profiles.id for the current authenticated user.
--    Used in donor-scoped policies.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_donor_profile_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM public.donor_profiles
  WHERE user_id = auth.uid();
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. HELPER FUNCTION: get_ngo_profile_id()
--    Returns the ngo_profiles.id for the current authenticated user.
--    Used in NGO-scoped policies.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ngo_profile_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM public.ngo_profiles
  WHERE user_id = auth.uid();
  RETURN v_id;
END;
$$;

-- ===========================================================================
-- ENABLE ROW LEVEL SECURITY ON ALL APPLICATION TABLES
-- Tables without RLS enabled are open to any authenticated (or anonymous)
-- Supabase client, which is a critical security vulnerability.
-- ===========================================================================

ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donor_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngo_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_bins         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_trays         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_telemetry   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_donations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donation_claims    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freshness_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impact_metrics     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs         ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- TABLE: users
-- ===========================================================================

-- Users can view their own profile
CREATE POLICY "users: self select"
  ON public.users FOR SELECT
  USING (id = auth.uid());

-- Users can update only their own profile (role and status changes require admin)
CREATE POLICY "users: self update"
  ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Admins can view all users
CREATE POLICY "users: admin select all"
  ON public.users FOR SELECT
  USING (is_admin());

-- Admins can update any user (e.g., status changes: ACTIVE/SUSPENDED)
CREATE POLICY "users: admin update"
  ON public.users FOR UPDATE
  USING (is_admin());

-- Admins can delete users (soft-delete via status is preferred, but hard delete is permitted)
CREATE POLICY "users: admin delete"
  ON public.users FOR DELETE
  USING (is_admin());

-- INSERT is handled by handle_new_user() trigger (SECURITY DEFINER).
-- No direct client INSERT policy needed.

-- ===========================================================================
-- TABLE: donor_profiles
-- ===========================================================================

-- Donors can view their own profile
CREATE POLICY "donor_profiles: self select"
  ON public.donor_profiles FOR SELECT
  USING (user_id = auth.uid());

-- Donors can insert their own profile (registration flow)
CREATE POLICY "donor_profiles: self insert"
  ON public.donor_profiles FOR INSERT
  WITH CHECK (user_id = auth.uid() AND get_current_user_role() = 'DONOR');

-- Donors can update their own profile
CREATE POLICY "donor_profiles: self update"
  ON public.donor_profiles FOR UPDATE
  USING (user_id = auth.uid());

-- Admins can view all donor profiles
CREATE POLICY "donor_profiles: admin select all"
  ON public.donor_profiles FOR SELECT
  USING (is_admin());

-- Admins can update any donor profile
CREATE POLICY "donor_profiles: admin update"
  ON public.donor_profiles FOR UPDATE
  USING (is_admin());

-- ===========================================================================
-- TABLE: ngo_profiles
-- ===========================================================================

-- NGOs can view their own profile
CREATE POLICY "ngo_profiles: self select"
  ON public.ngo_profiles FOR SELECT
  USING (user_id = auth.uid());

-- NGOs can create their own profile (registration flow)
CREATE POLICY "ngo_profiles: self insert"
  ON public.ngo_profiles FOR INSERT
  WITH CHECK (user_id = auth.uid() AND get_current_user_role() = 'NGO');

-- NGOs can update their own profile
CREATE POLICY "ngo_profiles: self update"
  ON public.ngo_profiles FOR UPDATE
  USING (user_id = auth.uid());

-- Verified NGOs are visible to authenticated DONOR users (for transparency/matching display)
CREATE POLICY "ngo_profiles: donors can see verified"
  ON public.ngo_profiles FOR SELECT
  USING (
    verification_status = 'VERIFIED'
    AND get_current_user_role() = 'DONOR'
  );

-- Admins can view and modify all NGO profiles (including verification)
CREATE POLICY "ngo_profiles: admin select all"
  ON public.ngo_profiles FOR SELECT
  USING (is_admin());

CREATE POLICY "ngo_profiles: admin update"
  ON public.ngo_profiles FOR UPDATE
  USING (is_admin());

-- ===========================================================================
-- TABLE: smart_bins
-- ===========================================================================

-- Donors can view their own bins
CREATE POLICY "smart_bins: donor select own"
  ON public.smart_bins FOR SELECT
  USING (donor_id = get_donor_profile_id());

-- Donors can register new bins linked to their profile
CREATE POLICY "smart_bins: donor insert"
  ON public.smart_bins FOR INSERT
  WITH CHECK (
    donor_id = get_donor_profile_id()
    AND get_current_user_role() = 'DONOR'
  );

-- Donors can update their own bins (e.g., firmware note, location_note)
CREATE POLICY "smart_bins: donor update own"
  ON public.smart_bins FOR UPDATE
  USING (donor_id = get_donor_profile_id());

-- Admins can view and update all bins
CREATE POLICY "smart_bins: admin select all"
  ON public.smart_bins FOR SELECT
  USING (is_admin());

CREATE POLICY "smart_bins: admin update"
  ON public.smart_bins FOR UPDATE
  USING (is_admin());

-- ===========================================================================
-- TABLE: food_trays
-- ===========================================================================

-- Donors can view trays in their own bins
CREATE POLICY "food_trays: donor select own"
  ON public.food_trays FOR SELECT
  USING (
    bin_id IN (
      SELECT id FROM public.smart_bins
      WHERE donor_id = get_donor_profile_id()
    )
  );

-- Donors can configure tray categories
CREATE POLICY "food_trays: donor insert"
  ON public.food_trays FOR INSERT
  WITH CHECK (
    bin_id IN (
      SELECT id FROM public.smart_bins
      WHERE donor_id = get_donor_profile_id()
    )
  );

CREATE POLICY "food_trays: donor update own"
  ON public.food_trays FOR UPDATE
  USING (
    bin_id IN (
      SELECT id FROM public.smart_bins
      WHERE donor_id = get_donor_profile_id()
    )
  );

-- Admins can view all trays
CREATE POLICY "food_trays: admin select all"
  ON public.food_trays FOR SELECT
  USING (is_admin());

-- ===========================================================================
-- TABLE: sensor_telemetry
-- ===========================================================================
-- NOTE: Telemetry is written exclusively via the service role client in
-- the /api/iot/telemetry route handler (which bypasses RLS).
-- Read access is restricted to the bin's owner (donor) and admins.

-- Donors can read telemetry from their own bins
CREATE POLICY "sensor_telemetry: donor select own"
  ON public.sensor_telemetry FOR SELECT
  USING (
    bin_id IN (
      SELECT id FROM public.smart_bins
      WHERE donor_id = get_donor_profile_id()
    )
  );

-- Admins can read all telemetry
CREATE POLICY "sensor_telemetry: admin select all"
  ON public.sensor_telemetry FOR SELECT
  USING (is_admin());

-- ===========================================================================
-- TABLE: food_donations
-- ===========================================================================

-- All authenticated users can view AVAILABLE donations (NGO matching, browse)
CREATE POLICY "food_donations: authenticated can see available"
  ON public.food_donations FOR SELECT
  USING (
    status = 'AVAILABLE'
    AND auth.uid() IS NOT NULL
  );

-- Donors can see all of their own donations (any status)
CREATE POLICY "food_donations: donor select own"
  ON public.food_donations FOR SELECT
  USING (donor_id = get_donor_profile_id());

-- Donors can create donations
CREATE POLICY "food_donations: donor insert"
  ON public.food_donations FOR INSERT
  WITH CHECK (
    donor_id = get_donor_profile_id()
    AND get_current_user_role() = 'DONOR'
  );

-- Donors can update their own donations (e.g., cancel, update description)
CREATE POLICY "food_donations: donor update own"
  ON public.food_donations FOR UPDATE
  USING (donor_id = get_donor_profile_id());

-- NGOs can view donations that they have claimed (any status)
CREATE POLICY "food_donations: ngo see claimed"
  ON public.food_donations FOR SELECT
  USING (
    get_current_user_role() = 'NGO'
    AND id IN (
      SELECT donation_id FROM public.donation_claims
      WHERE ngo_id = get_ngo_profile_id()
    )
  );

-- Admins can view and update all donations
CREATE POLICY "food_donations: admin select all"
  ON public.food_donations FOR SELECT
  USING (is_admin());

CREATE POLICY "food_donations: admin update"
  ON public.food_donations FOR UPDATE
  USING (is_admin());

-- ===========================================================================
-- TABLE: donation_claims
-- ===========================================================================

-- NGOs can view their own claims
CREATE POLICY "donation_claims: ngo select own"
  ON public.donation_claims FOR SELECT
  USING (ngo_id = get_ngo_profile_id());

-- NGOs can submit new claims
CREATE POLICY "donation_claims: ngo insert"
  ON public.donation_claims FOR INSERT
  WITH CHECK (
    ngo_id = get_ngo_profile_id()
    AND get_current_user_role() = 'NGO'
  );

-- Donors can view claims on their own donations
CREATE POLICY "donation_claims: donor select on own donations"
  ON public.donation_claims FOR SELECT
  USING (
    donation_id IN (
      SELECT id FROM public.food_donations
      WHERE donor_id = get_donor_profile_id()
    )
  );

-- Admins can view and update all claims
CREATE POLICY "donation_claims: admin select all"
  ON public.donation_claims FOR SELECT
  USING (is_admin());

CREATE POLICY "donation_claims: admin update"
  ON public.donation_claims FOR UPDATE
  USING (is_admin());

-- ===========================================================================
-- TABLE: pickups
-- ===========================================================================

-- NGOs can view their own pickups
CREATE POLICY "pickups: ngo select own"
  ON public.pickups FOR SELECT
  USING (ngo_id = get_ngo_profile_id());

-- Donors can view pickups for their own donations
CREATE POLICY "pickups: donor select on own donations"
  ON public.pickups FOR SELECT
  USING (
    donation_id IN (
      SELECT id FROM public.food_donations
      WHERE donor_id = get_donor_profile_id()
    )
  );

-- Admins can view and update all pickups
CREATE POLICY "pickups: admin select all"
  ON public.pickups FOR SELECT
  USING (is_admin());

CREATE POLICY "pickups: admin update"
  ON public.pickups FOR UPDATE
  USING (is_admin());

-- ===========================================================================
-- TABLE: freshness_logs
-- ===========================================================================

-- Donors can view freshness logs for their own donations
CREATE POLICY "freshness_logs: donor select own"
  ON public.freshness_logs FOR SELECT
  USING (
    donation_id IN (
      SELECT id FROM public.food_donations
      WHERE donor_id = get_donor_profile_id()
    )
  );

-- NGOs can view freshness logs for donations they have claimed
CREATE POLICY "freshness_logs: ngo select claimed"
  ON public.freshness_logs FOR SELECT
  USING (
    donation_id IN (
      SELECT donation_id FROM public.donation_claims
      WHERE ngo_id = get_ngo_profile_id()
    )
  );

-- Admins can view all freshness logs
CREATE POLICY "freshness_logs: admin select all"
  ON public.freshness_logs FOR SELECT
  USING (is_admin());

-- ===========================================================================
-- TABLE: notifications
-- ===========================================================================

-- Users can only read their own notifications
CREATE POLICY "notifications: self select"
  ON public.notifications FOR SELECT
  USING (recipient_user_id = auth.uid());

-- Users can mark their own notifications as read
CREATE POLICY "notifications: self update read"
  ON public.notifications FOR UPDATE
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

-- Admins can view all notifications
CREATE POLICY "notifications: admin select all"
  ON public.notifications FOR SELECT
  USING (is_admin());

-- INSERT is handled exclusively by the service-role API handler (bypasses RLS)

-- ===========================================================================
-- TABLE: impact_metrics
-- ===========================================================================

-- Donors can see impact metrics for their own donations
CREATE POLICY "impact_metrics: donor select own"
  ON public.impact_metrics FOR SELECT
  USING (
    donation_id IN (
      SELECT id FROM public.food_donations
      WHERE donor_id = get_donor_profile_id()
    )
  );

-- NGOs can see impact metrics for donations they fulfilled
CREATE POLICY "impact_metrics: ngo select fulfilled"
  ON public.impact_metrics FOR SELECT
  USING (
    donation_id IN (
      SELECT donation_id FROM public.pickups
      WHERE ngo_id = get_ngo_profile_id()
    )
  );

-- All authenticated users can view aggregated impact (for public analytics display)
CREATE POLICY "impact_metrics: authenticated select for analytics"
  ON public.impact_metrics FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Admins can view all impact metrics
CREATE POLICY "impact_metrics: admin select all"
  ON public.impact_metrics FOR SELECT
  USING (is_admin());

-- ===========================================================================
-- TABLE: audit_logs
-- ===========================================================================
-- Audit logs are append-only. No UPDATE or DELETE policies are defined.
-- INSERT is performed exclusively by the service-role client.

-- Admins can query the full audit trail
CREATE POLICY "audit_logs: admin select all"
  ON public.audit_logs FOR SELECT
  USING (is_admin());

-- Users can view audit entries where they are the actor
-- (e.g., viewing their own action history)
CREATE POLICY "audit_logs: self select own"
  ON public.audit_logs FOR SELECT
  USING (actor_id = auth.uid());

-- =============================================================================
-- END: 20261001000005_rls_policies.sql
-- =============================================================================
