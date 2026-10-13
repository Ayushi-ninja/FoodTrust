/**
 * lib/validation/claim.schema.ts
 * FoodTrust — Phase 7: NGO Claim Management
 *
 * Strict Zod validation schemas for donation claims:
 * - Submit / Create Claim
 * - Query / List Claims
 * - Claim Response (Approve / Reject)
 */

import { z } from 'zod';

export const claimStatusEnum = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
]);

/**
 * Payload for POST /api/donations/[id]/claim
 */
export const createClaimSchema = z.object({
  notes: z
    .string()
    .trim()
    .max(500, { message: 'Notes cannot exceed 500 characters' })
    .optional(),
});

/**
 * Query schema for GET /api/claims
 */
export const listClaimsQuerySchema = z.object({
  status: claimStatusEnum.optional(),
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

/**
 * Payload for POST /api/claims/[id]/approve
 */
export const approveClaimSchema = z.object({
  notes: z
    .string()
    .trim()
    .max(500, { message: 'Notes cannot exceed 500 characters' })
    .optional(),
});

/**
 * Payload for POST /api/claims/[id]/reject
 */
export const rejectClaimSchema = z.object({
  reason: z
    .string({ required_error: 'Rejection reason is required' })
    .trim()
    .min(3, { message: 'Rejection reason must be at least 3 characters' })
    .max(500, { message: 'Rejection reason cannot exceed 500 characters' }),
});

export type CreateClaimInput = z.infer<typeof createClaimSchema>;
export type ListClaimsQueryInput = z.infer<typeof listClaimsQuerySchema>;
export type ApproveClaimInput = z.infer<typeof approveClaimSchema>;
export type RejectClaimInput = z.infer<typeof rejectClaimSchema>;
