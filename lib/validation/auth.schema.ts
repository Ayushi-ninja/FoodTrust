/**
 * lib/validation/auth.schema.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Strict Zod validation schemas for:
 *   - User registration (DONOR, NGO only)
 *   - User authentication (login)
 *   - Donor profile update
 *   - NGO profile update
 *
 * SECURITY CONTRACT:
 *   - NEVER trust client-provided IDs, roles, statuses, verification flags, or timestamps.
 *   - Public registration allows ONLY 'DONOR' and 'NGO' roles.
 *   - ADMIN, SUPER_ADMIN, and DEVICE registration are strictly rejected.
 *   - NGO verification_status cannot be set by the client.
 */

import { z } from 'zod';

// ============================================================================
// Shared Primitive Validators
// ============================================================================

export const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .email('Invalid email address')
  .max(255, 'Email cannot exceed 255 characters');

export const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters long')
  .max(100, 'Password cannot exceed 100 characters');

export const phoneSchema = z
  .string()
  .trim()
  .max(20, 'Phone number cannot exceed 20 characters')
  .optional()
  .nullable();

export const latitudeSchema = z
  .number({ required_error: 'Latitude is required' })
  .min(-90, 'Latitude must be between -90 and 90')
  .max(90, 'Latitude must be between -90 and 90');

export const longitudeSchema = z
  .number({ required_error: 'Longitude is required' })
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

// ============================================================================
// Login Schema
// ============================================================================

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password cannot be empty'),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ============================================================================
// Donor Profile Schemas
// ============================================================================

export const donorProfileFieldsSchema = z.object({
  business_name: z
    .string({ required_error: 'Business name is required' })
    .trim()
    .min(2, 'Business name must be at least 2 characters')
    .max(150, 'Business name cannot exceed 150 characters'),
  establishment_type: z.string().trim().max(50).optional().nullable(),
  fssai_license: z.string().trim().max(50).optional().nullable(),
  address: z
    .string({ required_error: 'Address is required' })
    .trim()
    .min(5, 'Address must be at least 5 characters')
    .max(500, 'Address cannot exceed 500 characters'),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  contact_person: z.string().trim().max(100).optional().nullable(),
});

export const updateDonorProfileSchema = donorProfileFieldsSchema.partial();
export type UpdateDonorProfileInput = z.infer<typeof updateDonorProfileSchema>;

// ============================================================================
// NGO Profile Schemas
// ============================================================================

export const ngoProfileFieldsSchema = z.object({
  organization_name: z
    .string({ required_error: 'Organization name is required' })
    .trim()
    .min(2, 'Organization name must be at least 2 characters')
    .max(150, 'Organization name cannot exceed 150 characters'),
  registration_number: z
    .string({ required_error: 'Registration number is required' })
    .trim()
    .min(2, 'Registration number must be at least 2 characters')
    .max(100, 'Registration number cannot exceed 100 characters'),
  operational_radius_km: z
    .number()
    .positive('Operational radius must be positive')
    .max(200, 'Operational radius cannot exceed 200 km')
    .default(15.0),
  has_cold_storage: z.boolean().default(false),
  daily_capacity_kg: z
    .number()
    .positive('Daily capacity must be positive')
    .max(100000, 'Daily capacity cannot exceed 100,000 kg')
    .default(100.0),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  address: z.string().trim().max(500).optional().nullable(),
  contact_person: z.string().trim().max(100).optional().nullable(),
  contact_phone: phoneSchema,
});

/**
 * Update NGO profile schema.
 * Explicitly EXCLUDES verification_status and user_id.
 * Verification is an administrative action only.
 */
export const updateNgoProfileSchema = ngoProfileFieldsSchema.partial();
export type UpdateNgoProfileInput = z.infer<typeof updateNgoProfileSchema>;

// ============================================================================
// Registration Schemas (Discriminated by role)
// ============================================================================

export const donorRegisterSchema = z.object({
  role: z.literal('DONOR'),
  email: emailSchema,
  password: passwordSchema,
  full_name: z
    .string({ required_error: 'Full name is required' })
    .trim()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name cannot exceed 100 characters'),
  phone: phoneSchema,
  donor_profile: donorProfileFieldsSchema,
});

export const ngoRegisterSchema = z.object({
  role: z.literal('NGO'),
  email: emailSchema,
  password: passwordSchema,
  full_name: z
    .string({ required_error: 'Full name is required' })
    .trim()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name cannot exceed 100 characters'),
  phone: phoneSchema,
  ngo_profile: ngoProfileFieldsSchema,
});

export const registerSchema = z.discriminatedUnion('role', [
  donorRegisterSchema,
  ngoRegisterSchema,
]);

export type RegisterInput = z.infer<typeof registerSchema>;
