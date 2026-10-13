/**
 * lib/validation/analytics.schema.ts
 * FoodTrust — Phase 9: Analytics, Notifications & Admin Oversight
 *
 * Zod schemas for analytics query parameters.
 */

import { z } from 'zod';

export const paginationSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(200)),
  offset: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 0))
    .pipe(z.number().int().min(0)),
});

export const adminAnalyticsQuerySchema = z.object({
  from_date: z.string().datetime({ offset: true }).optional(),
  to_date: z.string().datetime({ offset: true }).optional(),
});

export type PaginationParams = z.infer<typeof paginationSchema>;
export type AdminAnalyticsQuery = z.infer<typeof adminAnalyticsQuerySchema>;
