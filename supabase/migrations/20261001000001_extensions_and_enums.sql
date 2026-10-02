-- =============================================================================
-- Migration: 20261001000001_extensions_and_enums.sql
-- Project:   FoodTrust — AI + IoT Smart Food Waste Monitoring & Redistribution
-- Phase:     Phase 1 — Database Foundation
-- Step:      1 of 5 — PostgreSQL Extensions & Enum Types
--
-- IMPORTANT: Execute this migration in the Supabase Dashboard SQL Editor
--            or via the Supabase CLI (when available) BEFORE all other migrations.
--
-- References:
--   ARCHITECTURE.md       Section 5 (Enums), Section 9 (Security)
--   IMPLEMENTATION_DECISIONS.md Section 2.2 (Roles & Enums)
--   ARCHITECTURE_REVIEW.md      Issue 18.1 (PostGIS)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. PostgreSQL Extensions
-- ---------------------------------------------------------------------------

-- uuid-ossp: gen_random_uuid() / uuid_generate_v4() for UUID primary keys
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- PostGIS: GEOGRAPHY(Point, 4326) columns for NGO matching proximity queries
-- Required before any table that uses the GEOGRAPHY type is created.
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ---------------------------------------------------------------------------
-- 2. Custom ENUM Types
--    ARCHITECTURE_REVIEW.md Issue 18.1: Extensions must be created before enums.
--    All enums are defined here; tables reference them by type name.
-- ---------------------------------------------------------------------------

-- 2.1 User Roles
-- DEVICE: IoT ESP32 bin identity (no human user account required)
CREATE TYPE user_role_enum AS ENUM (
  'DONOR',
  'NGO',
  'ADMIN',
  'SUPER_ADMIN',
  'DEVICE'
);

-- 2.2 User Account Status
CREATE TYPE user_status_enum AS ENUM (
  'ACTIVE',
  'PENDING',
  'SUSPENDED'
);

-- 2.3 Food Category
-- Maps to individual food trays in the Food Handling Unit
CREATE TYPE food_category_enum AS ENUM (
  'COOKED_MEALS',
  'VEGETABLES',
  'FRUITS',
  'BAKERY',
  'DAIRY'
);

-- 2.4 Freshness Decision-Support Status
-- IMPORTANT: These values represent a DECISION-SUPPORT heuristic model.
-- They are NOT certified food safety determinations.
-- Ref: IMPLEMENTATION_DECISIONS.md Section 3.1
CREATE TYPE freshness_status_enum AS ENUM (
  'FRESH',
  'MODERATE',
  'CRITICAL',
  'EXPIRED'
);

-- 2.5 Risk Level (decision-support, not certified safety)
CREATE TYPE risk_level_enum AS ENUM (
  'LOW',
  'MODERATE',
  'HIGH',
  'CRITICAL'
);

-- 2.6 Donation Lifecycle State Machine
-- AVAILABLE → RESERVED → CLAIMED → PICKUP_IN_PROGRESS → PICKED_UP → DELIVERED
-- AVAILABLE → CANCELLED / EXPIRED (timeout or manual cancel)
-- Ref: ARCHITECTURE_REVIEW.md Issue 12.1
CREATE TYPE donation_status_enum AS ENUM (
  'AVAILABLE',
  'RESERVED',
  'CLAIMED',
  'PICKUP_IN_PROGRESS',
  'PICKED_UP',
  'DELIVERED',
  'CANCELLED',
  'EXPIRED'
);

-- 2.7 Smart Bin (Electronics Unit) Status
CREATE TYPE bin_status_enum AS ENUM (
  'ONLINE',
  'OFFLINE',
  'MAINTENANCE',
  'ALERT'
);

-- 2.8 Pickup Fulfillment Status
CREATE TYPE pickup_status_enum AS ENUM (
  'SCHEDULED',
  'EN_ROUTE',
  'ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'FAILED'
);

-- 2.9 Donation Claim Status
-- Partial unique index on (donation_id) WHERE status IN ('APPROVED','PENDING')
-- prevents concurrent double-claiming. Ref: IMPLEMENTATION_DECISIONS.md Section 2.4
CREATE TYPE claim_status_enum AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED'
);

-- 2.10 NGO Verification Status
CREATE TYPE verification_status_enum AS ENUM (
  'PENDING',
  'VERIFIED',
  'REJECTED'
);

-- =============================================================================
-- END: 20261001000001_extensions_and_enums.sql
-- =============================================================================
