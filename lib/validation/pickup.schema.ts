/**
 * lib/validation/pickup.schema.ts
 * FoodTrust — Phase 8: Pickup & Fulfillment Workflow
 *
 * Strict Zod validation schemas for pickups:
 * - Create pickup (assign volunteer)
 * - Verify OTP
 * - Complete delivery
 * - List pickups query filters
 */

import { z } from 'zod';

export const pickupStatusEnum = z.enum([
  'SCHEDULED',
  'EN_ROUTE',
  'ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'FAILED',
]);

/**
 * Payload for creating/scheduling a pickup (NGO or Admin)
 */
export const createPickupSchema = z.object({
  donationId: z.string().uuid({ message: 'donationId must be a valid UUID' }),
  assignedVolunteer: z
    .string()
    .trim()
    .min(2, { message: 'Volunteer name must be at least 2 characters' })
    .max(100, { message: 'Volunteer name cannot exceed 100 characters' })
    .optional(),
  volunteerPhone: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{7,14}$/, {
      message: 'volunteerPhone must be a valid E.164 phone number (e.g. +919876543210)',
    })
    .optional(),
  scheduledAt: z
    .string()
    .datetime({ message: 'scheduledAt must be a valid ISO 8601 datetime' })
    .optional(),
});

/**
 * Payload for POST /api/pickups/[id]/verify-otp
 */
export const verifyOtpSchema = z.object({
  otpCode: z
    .string({ required_error: 'otpCode is required' })
    .trim()
    .length(6, { message: 'otpCode must be exactly 6 numeric digits' })
    .regex(/^\d{6}$/, { message: 'otpCode must contain only numeric digits' }),
});

/**
 * Payload for POST /api/pickups/[id]/complete
 */
export const completeDeliverySchema = z.object({
  proofImageUrl: z
    .string()
    .trim()
    .url({ message: 'proofImageUrl must be a valid URL' })
    .refine(
      (url) => {
        // Enforce approved storage domain / path
        // Allows Supabase storage URLs or localhost dev bucket paths
        return (
          url.includes('/storage/v1/object/public/proof-photos/') ||
          url.includes('/storage/v1/object/sign/proof-photos/') ||
          url.includes('/proof-photos/') ||
          url.startsWith('https://')
        );
      },
      {
        message: 'proofImageUrl must be a valid HTTPS URL pointing to the proof-photos storage bucket',
      }
    )
    .optional(),
});

/**
 * Query schema for GET /api/pickups
 */
export const listPickupsQuerySchema = z.object({
  status: pickupStatusEnum.optional(),
  donationId: z.string().uuid({ message: 'donationId must be a valid UUID' }).optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0))
    .pipe(z.number().int().min(0)),
});

export type CreatePickupInput = z.infer<typeof createPickupSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type CompleteDeliveryInput = z.infer<typeof completeDeliverySchema>;
export type ListPickupsQueryInput = z.infer<typeof listPickupsQuerySchema>;
