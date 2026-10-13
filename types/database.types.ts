/**
 * database.types.ts
 * FoodTrust — AI + IoT Smart Food Waste Monitoring & Redistribution System
 * Phase 1 & 2 Database Foundation & Client Definitions
 *
 * Hand-authored TypeScript types matching the PostgreSQL schema defined in
 * supabase/migrations/20261001000001_extensions_and_enums.sql through
 * supabase/migrations/20261001000005_rls_policies.sql.
 *
 * Configured with full Supabase JS client v2 GenericSchema compatibility
 * (Row, Insert, Update, Relationships).
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
  freshness_score: number;
  freshness_status: FreshnessStatus;
  risk_level: RiskLevel;
  shelf_life_hours_remaining: number;
  status: DonationStatus;
  pickup_address: string;
  latitude: number;
  longitude: number;
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
 */
export interface ImpactMetric {
  id: string;                       // UUID
  donation_id: string;              // FK → food_donations.id (UNIQUE)
  weight_kg: number;
  estimated_meals_served: number;
  estimated_co2_offset_kg: number;
  kg_per_meal_factor: number;
  co2_factor_per_kg: number;
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
  target_table: string;             // e.g., 'food_donations', 'smart_bins'
  target_id: string | null;         // UUID of the affected record
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

// ===========================================================================
// SUPABASE DATABASE TYPE WRAPPER
// Structured for full compatibility with Supabase JS v2 client generic.
// ===========================================================================

export type Database = {
  public: {
    Tables: {
      users: {
        Row: User;
        Insert: {
          id: string;
          email: string;
          full_name: string;
          phone?: string | null;
          role?: UserRole;
          status?: UserStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          phone?: string | null;
          role?: UserRole;
          status?: UserStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      donor_profiles: {
        Row: DonorProfile;
        Insert: {
          id?: string;
          user_id: string;
          business_name: string;
          establishment_type?: string | null;
          fssai_license?: string | null;
          address: string;
          latitude: number;
          longitude: number;
          contact_person?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          business_name?: string;
          establishment_type?: string | null;
          fssai_license?: string | null;
          address?: string;
          latitude?: number;
          longitude?: number;
          contact_person?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ngo_profiles: {
        Row: NgoProfile;
        Insert: {
          id?: string;
          user_id: string;
          organization_name: string;
          registration_number: string;
          operational_radius_km?: number;
          has_cold_storage?: boolean;
          daily_capacity_kg?: number;
          latitude: number;
          longitude: number;
          verification_status?: VerificationStatus;
          address?: string | null;
          contact_person?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          organization_name?: string;
          registration_number?: string;
          operational_radius_km?: number;
          has_cold_storage?: boolean;
          daily_capacity_kg?: number;
          latitude?: number;
          longitude?: number;
          verification_status?: VerificationStatus;
          address?: string | null;
          contact_person?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      smart_bins: {
        Row: SmartBin;
        Insert: {
          id?: string;
          bin_code: string;
          donor_id: string;
          api_key_hash: string;
          status?: BinStatus;
          firmware_version?: string | null;
          last_heartbeat_at?: string | null;
          location_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          bin_code?: string;
          donor_id?: string;
          api_key_hash?: string;
          status?: BinStatus;
          firmware_version?: string | null;
          last_heartbeat_at?: string | null;
          location_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      food_trays: {
        Row: FoodTray;
        Insert: {
          id?: string;
          bin_id: string;
          tray_number: number;
          assigned_category?: FoodCategory;
          current_weight_kg?: number;
          tare_weight_kg?: number;
          last_calibrated_at?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          bin_id?: string;
          tray_number?: number;
          assigned_category?: FoodCategory;
          current_weight_kg?: number;
          tare_weight_kg?: number;
          last_calibrated_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      sensor_telemetry: {
        Row: SensorTelemetry;
        Insert: {
          id?: number;
          bin_id: string;
          tray_id?: string | null;
          weight_kg?: number | null;
          temperature_c: number;
          humidity_pct: number;
          voc_gas_ppm: number;
          lid_open?: boolean;
          battery_pct?: number | null;
          firmware_version?: string | null;
          recorded_at?: string;
        };
        Update: {
          id?: number;
          bin_id?: string;
          tray_id?: string | null;
          weight_kg?: number | null;
          temperature_c?: number;
          humidity_pct?: number;
          voc_gas_ppm?: number;
          lid_open?: boolean;
          battery_pct?: number | null;
          firmware_version?: string | null;
          recorded_at?: string;
        };
        Relationships: [];
      };
      food_donations: {
        Row: FoodDonation;
        Insert: {
          id?: string;
          donor_id: string;
          bin_id?: string | null;
          tray_id?: string | null;
          title: string;
          description?: string | null;
          food_category: FoodCategory;
          quantity_kg: number;
          preparation_timestamp: string;
          freshness_score?: number;
          freshness_status?: FreshnessStatus;
          risk_level?: RiskLevel;
          shelf_life_hours_remaining?: number;
          status?: DonationStatus;
          pickup_address: string;
          latitude: number;
          longitude: number;
          image_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          donor_id?: string;
          bin_id?: string | null;
          tray_id?: string | null;
          title?: string;
          description?: string | null;
          food_category?: FoodCategory;
          quantity_kg?: number;
          preparation_timestamp?: string;
          freshness_score?: number;
          freshness_status?: FreshnessStatus;
          risk_level?: RiskLevel;
          shelf_life_hours_remaining?: number;
          status?: DonationStatus;
          pickup_address?: string;
          latitude?: number;
          longitude?: number;
          image_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      donation_claims: {
        Row: DonationClaim;
        Insert: {
          id?: string;
          donation_id: string;
          ngo_id: string;
          status?: ClaimStatus;
          claimed_at?: string;
          responded_at?: string | null;
          notes?: string | null;
        };
        Update: {
          status?: ClaimStatus;
          responded_at?: string | null;
          notes?: string | null;
        };
        Relationships: [];
      };
      pickups: {
        Row: Pickup;
        Insert: {
          id?: string;
          donation_id: string;
          ngo_id: string;
          assigned_volunteer?: string | null;
          volunteer_phone?: string | null;
          otp_code_hash: string;
          otp_attempt_count?: number;
          otp_expires_at?: string | null;
          status?: PickupStatus;
          proof_image_url?: string | null;
          scheduled_at?: string | null;
          picked_up_at?: string | null;
          delivered_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          assigned_volunteer?: string | null;
          volunteer_phone?: string | null;
          otp_attempt_count?: number;
          status?: PickupStatus;
          proof_image_url?: string | null;
          scheduled_at?: string | null;
          picked_up_at?: string | null;
          delivered_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      freshness_logs: {
        Row: FreshnessLog;
        Insert: {
          id?: number;
          donation_id: string;
          evaluated_score: number;
          freshness_status: FreshnessStatus;
          risk_level: RiskLevel;
          shelf_life_hours: number;
          gas_reading_ppm?: number | null;
          temperature_c?: number | null;
          humidity_pct?: number | null;
          evaluated_at?: string;
        };
        Update: {
          id?: number;
          donation_id?: string;
          evaluated_score?: number;
          freshness_status?: FreshnessStatus;
          risk_level?: RiskLevel;
          shelf_life_hours?: number;
          gas_reading_ppm?: number | null;
          temperature_c?: number | null;
          humidity_pct?: number | null;
          evaluated_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: Notification;
        Insert: {
          id?: string;
          recipient_user_id: string;
          type: string;
          title: string;
          message: string;
          metadata?: Record<string, unknown> | null;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          is_read?: boolean;
        };
        Relationships: [];
      };
      impact_metrics: {
        Row: ImpactMetric;
        Insert: {
          id?: string;
          donation_id: string;
          weight_kg: number;
          estimated_meals_served: number;
          estimated_co2_offset_kg: number;
          kg_per_meal_factor?: number;
          co2_factor_per_kg?: number;
          logged_at?: string;
        };
        Update: {
          id?: string;
          donation_id?: string;
          weight_kg?: number;
          estimated_meals_served?: number;
          estimated_co2_offset_kg?: number;
          kg_per_meal_factor?: number;
          co2_factor_per_kg?: number;
          logged_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: AuditLog;
        Insert: {
          id?: number;
          actor_id?: string | null;
          actor_role?: string | null;
          action: string;
          target_table: string;
          target_id?: string | null;
          old_values?: Record<string, unknown> | null;
          new_values?: Record<string, unknown> | null;
          ip_address?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          actor_id?: string | null;
          actor_role?: string | null;
          action?: string;
          target_table?: string;
          target_id?: string | null;
          old_values?: Record<string, unknown> | null;
          new_values?: Record<string, unknown> | null;
          ip_address?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
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
