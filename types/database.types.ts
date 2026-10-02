/**
 * database.types.ts
 * FoodTrust — AI + IoT Smart Food Waste Monitoring & Redistribution System
 * Phase 1 — Database Foundation
 *
 * Hand-authored TypeScript types matching the PostgreSQL schema defined in
 * supabase/migrations/20261001000001_extensions_and_enums.sql through
 * supabase/migrations/20261001000005_rls_policies.sql.
 *
 * NOTE: These types are manually maintained because the Supabase CLI cannot
 * be run locally (Docker unavailable on this machine). Once Supabase CLI
 * access is available, regenerate with:
 *   npx supabase gen types typescript --project-id <PROJECT_ID> > types/database.types.ts
 *
 * References:
 *   ARCHITECTURE.md Section 5 (Table Definitions)
 *   IMPLEMENTATION_DECISIONS.md Section 2.2 (Roles & Enums)
 *   IMPLEMENTATION_DECISIONS.md Section 3 (Freshness & Impact Terminology)
 */

// ===========================================================================
// ENUM TYPES
// Mirrors the PostgreSQL ENUM definitions in migration 1.
// ===========================================================================

export type UserRole = 'DONOR' | 'NGO' | 'ADMIN' | 'SUPER_ADMIN' | 'DEVICE';

export type UserStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED';

export type FoodCategory =
  | 'COOKED_MEALS'
  | 'VEGETABLES'
  | 'FRUITS'
  | 'BAKERY'
  | 'DAIRY';

/**
 * Decision-support freshness evaluation status.
 * NOT a certified food safety determination.
 * Ref: IMPLEMENTATION_DECISIONS.md Section 3.1
 */
export type FreshnessStatus = 'FRESH' | 'MODERATE' | 'CRITICAL' | 'EXPIRED';

/**
 * Decision-support risk level.
 * NOT a certified food safety determination.
 * Ref: IMPLEMENTATION_DECISIONS.md Section 3.1
 */
export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export type DonationStatus =
  | 'AVAILABLE'
  | 'RESERVED'
  | 'CLAIMED'
  | 'PICKUP_IN_PROGRESS'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'EXPIRED';

export type BinStatus = 'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'ALERT';

export type PickupStatus =
  | 'SCHEDULED'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'FAILED';

export type ClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

// ===========================================================================
// TABLE ROW TYPES
// Each interface corresponds exactly to a database table row as returned
// by the Supabase JS client (snake_case column names).
// ===========================================================================

/**
 * public.users
 * Application user profile. Mirrors auth.users.id.
 * Populated automatically by handle_new_user() trigger.
 */
export interface User {
  id: string;                  // UUID — matches auth.users.id
  email: string;
  phone: string | null;
  full_name: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;          // ISO 8601 timestamp string
  updated_at: string;
}

/**
 * public.donor_profiles
 * Donor organization profile (restaurants, hotels, cafeterias, etc.).
 * location column (PostGIS GEOGRAPHY) is excluded — not returned as plain JSON.
 */
export interface DonorProfile {
  id: string;                  // UUID
  user_id: string;             // FK → users.id
  business_name: string;
  establishment_type: string | null;
  fssai_license: string | null;
  address: string;
  latitude: number;
  longitude: number;
  // location: excluded (PostGIS GEOGRAPHY type, not directly JSON-serializable)
  contact_person: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * public.ngo_profiles
 * NGO organization profile.
 */
export interface NgoProfile {
  id: string;                  // UUID
  user_id: string;             // FK → users.id
  organization_name: string;
  registration_number: string;
  operational_radius_km: number;
  has_cold_storage: boolean;
  daily_capacity_kg: number;
  latitude: number;
  longitude: number;
  // location: excluded (PostGIS GEOGRAPHY)
  verification_status: VerificationStatus;
  address: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * public.smart_bins
 * Electronics Unit registration record.
 * api_key_hash is present but should never be returned to client responses.
 */
export interface SmartBin {
  id: string;                  // UUID
  bin_code: string;            // e.g., 'BIN-DELHI-001'
  donor_id: string;            // FK → donor_profiles.id
  api_key_hash: string;        // SHA-256 hash — never expose in API responses
  status: BinStatus;
  firmware_version: string | null;
  last_heartbeat_at: string | null;
  location_note: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * public.food_trays
 * Individual removable tray platform inside the Food Handling Unit.
 */
export interface FoodTray {
  id: string;                  // UUID
  bin_id: string;              // FK → smart_bins.id
  tray_number: number;
  assigned_category: FoodCategory;
  current_weight_kg: number;
  tare_weight_kg: number;
  last_calibrated_at: string | null;
  updated_at: string;
}

/**
 * public.sensor_telemetry
 * High-frequency time-series telemetry from ESP32.
 * Primary key is BIGSERIAL (number, not UUID).
 */
export interface SensorTelemetry {
  id: number;                  // BIGSERIAL
  bin_id: string;              // FK → smart_bins.id
  tray_id: string | null;      // FK → food_trays.id (null for chamber-level readings)
  weight_kg: number | null;    // null for chamber ambient records
  temperature_c: number;
  humidity_pct: number;
  voc_gas_ppm: number;
  lid_open: boolean;
  battery_pct: number | null;
  firmware_version: string | null;
  recorded_at: string;
}

/**
 * public.food_donations
 * Core donation record.
 *
 * IMPORTANT: freshness_score, freshness_status, risk_level are decision-support
 * heuristics based on ambient telemetry. They are NOT certified food safety
 * determinations. Ref: IMPLEMENTATION_DECISIONS.md Section 3.1
 */
export interface FoodDonation {
  id: string;                        // UUID
  donor_id: string;                  // FK → donor_profiles.id
  bin_id: string | null;             // FK → smart_bins.id (null for manual donations)
  tray_id: string | null;            // FK → food_trays.id (null for manual donations)
  title: string;
  description: string | null;
  food_category: FoodCategory;
  quantity_kg: number;
  preparation_timestamp: string;
  /**
   * Decision-support freshness score (0–100).
   * NOT a certified food safety determination.
   */
  freshness_score: number;
  /** Decision-support freshness status. NOT a certified food safety determination. */
  freshness_status: FreshnessStatus;
  /** Decision-support risk level. NOT a certified food safety determination. */
  risk_level: RiskLevel;
  shelf_life_hours_remaining: number;
  status: DonationStatus;
  pickup_address: string;
  latitude: number;
  longitude: number;
  // location: excluded (PostGIS GEOGRAPHY)
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * public.donation_claims
 * NGO claim attempts on a food donation.
 */
export interface DonationClaim {
  id: string;                  // UUID
  donation_id: string;         // FK → food_donations.id
  ngo_id: string;              // FK → ngo_profiles.id
  status: ClaimStatus;
  claimed_at: string;
  responded_at: string | null;
  notes: string | null;
}

/**
 * public.pickups
 * Pickup fulfillment record with OTP verification.
 * otp_code_hash is stored but must NEVER be returned in API responses.
 */
export interface Pickup {
  id: string;                  // UUID
  donation_id: string;         // FK → food_donations.id (UNIQUE)
  ngo_id: string;              // FK → ngo_profiles.id
  assigned_volunteer: string | null;
  volunteer_phone: string | null;
  otp_code_hash: string;       // SHA-256 hashed OTP — never expose in responses
  otp_attempt_count: number;   // Max 3 before invalidation
  otp_expires_at: string | null;
  status: PickupStatus;
  proof_image_url: string | null;
  scheduled_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * public.freshness_logs
 * Time-series freshness evaluation snapshot.
 * Primary key is BIGSERIAL (number, not UUID).
 *
 * IMPORTANT: All fields are decision-support values, NOT certified safety records.
 */
export interface FreshnessLog {
  id: number;                  // BIGSERIAL
  donation_id: string;         // FK → food_donations.id
  evaluated_score: number;     // 0–100, decision-support
  freshness_status: FreshnessStatus;
  risk_level: RiskLevel;
  shelf_life_hours: number;
  gas_reading_ppm: number | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  evaluated_at: string;
}

/**
 * public.notifications
 * In-app notification record for any user role.
 */
export interface Notification {
  id: string;                  // UUID
  recipient_user_id: string;   // FK → users.id
  type: string;                // e.g., 'DONATION_AVAILABLE', 'PICKUP_ASSIGNED'
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;  // JSONB
  is_read: boolean;
  created_at: string;
}

/**
 * public.impact_metrics
 * Estimated impact record per completed donation.
 * Values are CONFIGURABLE ESTIMATES, not official measurements.
 * Ref: IMPLEMENTATION_DECISIONS.md Section 3.2
 */
export interface ImpactMetric {
  id: string;                       // UUID
  donation_id: string;              // FK → food_donations.id (UNIQUE)
  weight_kg: number;
  /** ROUND(weight_kg / kg_per_meal_factor). Default: 0.4 kg/meal */
  estimated_meals_served: number;
  /** weight_kg * co2_factor_per_kg. Default: 2.5 kg CO2e/kg */
  estimated_co2_offset_kg: number;
  kg_per_meal_factor: number;       // Default 0.40 — FAO standard portion estimate
  co2_factor_per_kg: number;        // Default 2.50 — UNEP Food Waste Index
  logged_at: string;
}

/**
 * public.audit_logs
 * Immutable audit trail record. Append-only — never update or delete.
 * Primary key is BIGSERIAL (number, not UUID).
 */
export interface AuditLog {
  id: number;                       // BIGSERIAL
  actor_id: string | null;          // FK → users.id (null for system-generated events)
  actor_role: string | null;        // Snapshot of role at time of action
  action: string;                   // e.g., 'CLAIM_DONATION', 'BIN_CONFIG_UPDATE'
  target_table: string;             // e.g., 'food_donations'
  target_id: string | null;         // UUID of the affected record
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

// ===========================================================================
// SUPABASE DATABASE TYPE WRAPPER
// Structured for compatibility with the Supabase JS client's Database generic.
// Usage: createClient<Database>(url, key)
// ===========================================================================

export type Database = {
  public: {
    Tables: {
      users: {
        Row: User;
        Insert: Omit<User, 'created_at' | 'updated_at'> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<User, 'id'>>;
      };
      donor_profiles: {
        Row: DonorProfile;
        Insert: Omit<DonorProfile, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<DonorProfile, 'id' | 'user_id'>>;
      };
      ngo_profiles: {
        Row: NgoProfile;
        Insert: Omit<NgoProfile, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<NgoProfile, 'id' | 'user_id'>>;
      };
      smart_bins: {
        Row: SmartBin;
        Insert: Omit<SmartBin, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<SmartBin, 'id' | 'donor_id'>>;
      };
      food_trays: {
        Row: FoodTray;
        Insert: Omit<FoodTray, 'id' | 'updated_at'> & {
          id?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<FoodTray, 'id' | 'bin_id'>>;
      };
      sensor_telemetry: {
        Row: SensorTelemetry;
        Insert: Omit<SensorTelemetry, 'id' | 'recorded_at'> & {
          recorded_at?: string;
        };
        Update: never; // Telemetry is append-only
      };
      food_donations: {
        Row: FoodDonation;
        Insert: Omit<FoodDonation, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<FoodDonation, 'id' | 'donor_id'>>;
      };
      donation_claims: {
        Row: DonationClaim;
        Insert: Omit<DonationClaim, 'id' | 'claimed_at'> & {
          id?: string;
          claimed_at?: string;
        };
        Update: Partial<Pick<DonationClaim, 'status' | 'responded_at' | 'notes'>>;
      };
      pickups: {
        Row: Pickup;
        Insert: Omit<Pickup, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<Pickup, 'id' | 'donation_id' | 'ngo_id'>>;
      };
      freshness_logs: {
        Row: FreshnessLog;
        Insert: Omit<FreshnessLog, 'id' | 'evaluated_at'> & {
          evaluated_at?: string;
        };
        Update: never; // Freshness logs are append-only
      };
      notifications: {
        Row: Notification;
        Insert: Omit<Notification, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Pick<Notification, 'is_read'>>;
      };
      impact_metrics: {
        Row: ImpactMetric;
        Insert: Omit<ImpactMetric, 'id' | 'logged_at'> & {
          id?: string;
          logged_at?: string;
        };
        Update: never; // Impact metrics are append-only
      };
      audit_logs: {
        Row: AuditLog;
        Insert: Omit<AuditLog, 'id' | 'created_at'> & {
          created_at?: string;
        };
        Update: never; // Audit logs are immutable — append-only
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_current_user_role: {
        Args: Record<string, never>;
        Returns: UserRole;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      get_donor_profile_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      get_ngo_profile_id: {
        Args: Record<string, never>;
        Returns: string;
      };
    };
    Enums: {
      user_role_enum: UserRole;
      user_status_enum: UserStatus;
      food_category_enum: FoodCategory;
      freshness_status_enum: FreshnessStatus;
      risk_level_enum: RiskLevel;
      donation_status_enum: DonationStatus;
      bin_status_enum: BinStatus;
      pickup_status_enum: PickupStatus;
      claim_status_enum: ClaimStatus;
      verification_status_enum: VerificationStatus;
    };
  };
};
