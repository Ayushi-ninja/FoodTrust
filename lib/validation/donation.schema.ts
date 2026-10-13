/**
 * lib/validation/donation.schema.ts
 * FoodTrust — Phase 6: Food Donation Lifecycle Management
 *
 * Strict Zod validation schemas for food donation operations:
 * - Create donation
 * - Update donation
 * - Cancel donation
 * - Transition donation status
 * - Query/List donations
 */

import { z } from 'zod';
import { foodCategoryEnum } from '@/lib/validation/iot.schema';

export const donationStatusEnum = z.enum([
  'AVAILABLE',
  'RESERVED',
  'CLAIMED',
  'PICKUP_IN_PROGRESS',
  'PICKED_UP',
  'DELIVERED',
  'CANCELLED',
  'EXPIRED',
]);

/**
 * Payload for POST /api/donations (Donation Creation)
 */
export const createDonationSchema = z
  .object({
    title: z
      .string({ required_error: 'Title is required' })
      .trim()
      .min(3, { message: 'Title must be at least 3 characters' })
      .max(150, { message: 'Title cannot exceed 150 characters' }),
    description: z
      .string()
      .trim()
      .max(1000, { message: 'Description cannot exceed 1000 characters' })
      .nullable()
      .optional(),
    foodCategory: foodCategoryEnum,
    quantityKg: z
      .number({ required_error: 'quantityKg is required', invalid_type_error: 'quantityKg must be numeric' })
      .positive({ message: 'quantityKg must be greater than zero' })
      .max(5000, { message: 'quantityKg exceeds realistic single donation limit (5000 kg)' }),
    preparationTimestamp: z
      .string({ required_error: 'preparationTimestamp is required' })
      .datetime({ message: 'preparationTimestamp must be a valid ISO 8601 string' }),
    pickupAddress: z
      .string({ required_error: 'pickupAddress is required' })
      .trim()
      .min(5, { message: 'pickupAddress must be at least 5 characters' })
      .max(300, { message: 'pickupAddress cannot exceed 300 characters' }),
    latitude: z
      .number({ required_error: 'latitude is required', invalid_type_error: 'latitude must be numeric' })
      .min(-90, { message: 'latitude must be between -90 and 90' })
      .max(90, { message: 'latitude must be between -90 and 90' }),
    longitude: z
      .number({ required_error: 'longitude is required', invalid_type_error: 'longitude must be numeric' })
      .min(-180, { message: 'longitude must be between -180 and 180' })
      .max(180, { message: 'longitude must be between -180 and 180' }),
    binId: z.string().uuid({ message: 'binId must be a valid UUID' }).nullable().optional(),
    trayId: z.string().uuid({ message: 'trayId must be a valid UUID' }).nullable().optional(),
    imageUrl: z.string().url({ message: 'imageUrl must be a valid URL' }).nullable().optional(),
  })
  .refine(
    (data) => {
      // Preparation time cannot be in the future (with 5-minute clock-skew tolerance)
      const prep = new Date(data.preparationTimestamp).getTime();
      return prep <= Date.now() + 5 * 60 * 1000;
    },
    {
      message: 'preparationTimestamp cannot be in the future',
      path: ['preparationTimestamp'],
    }
  );

/**
 * Payload for PATCH /api/donations/[id] (Controlled Donor Updates)
 * Strictly forbids client manipulation of status, donor_id, or freshness fields!
 */
export const updateDonationSchema = z.object({
  title: z.string().trim().min(3).max(150).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  foodCategory: foodCategoryEnum.optional(),
  quantityKg: z.number().positive().max(5000).optional(),
  pickupAddress: z.string().trim().min(5).max(300).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  imageUrl: z.string().url().nullable().optional(),
});

/**
 * Payload for POST /api/donations/[id]/cancel
 */
export const cancelDonationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

/**
 * Payload for POST /api/donations/[id]/transition
 */
export const transitionDonationSchema = z.object({
  targetStatus: donationStatusEnum,
  reason: z.string().trim().max(500).optional(),
});

/**
 * Query schema for GET /api/donations
 */
export const listDonationQuerySchema = z.object({
  status: donationStatusEnum.optional(),
  category: foodCategoryEnum.optional(),
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

export type CreateDonationInput = z.infer<typeof createDonationSchema>;
export type UpdateDonationInput = z.infer<typeof updateDonationSchema>;
export type CancelDonationInput = z.infer<typeof cancelDonationSchema>;
export type TransitionDonationInput = z.infer<typeof transitionDonationSchema>;
export type ListDonationQueryInput = z.infer<typeof listDonationQuerySchema>;
