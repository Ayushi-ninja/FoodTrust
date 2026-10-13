/**
 * lib/validation/matching.schema.ts
 * FoodTrust — Phase 5: Smart NGO Matching Engine
 *
 * Strict Zod validation schemas for NGO matching requests.
 */

import { z } from 'zod';

export const matchingQuerySchema = z.object({
  donationId: z
    .string({ required_error: 'donationId is required' })
    .uuid({ message: 'donationId must be a valid UUID' }),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 10))
    .pipe(
      z
        .number()
        .int({ message: 'limit must be an integer' })
        .min(1, { message: 'limit must be at least 1' })
        .max(50, { message: 'limit cannot exceed 50' })
    ),
});

export const matchingPostSchema = z.object({
  donationId: z
    .string({ required_error: 'donationId is required' })
    .uuid({ message: 'donationId must be a valid UUID' }),
  limit: z
    .number()
    .int({ message: 'limit must be an integer' })
    .min(1, { message: 'limit must be at least 1' })
    .max(50, { message: 'limit cannot exceed 50' })
    .optional()
    .default(10),
});

export type MatchingQueryInput = z.infer<typeof matchingQuerySchema>;
export type MatchingPostInput = z.infer<typeof matchingPostSchema>;
