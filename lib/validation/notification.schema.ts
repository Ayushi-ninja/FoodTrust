/**
 * lib/validation/notification.schema.ts
 * FoodTrust — Phase 9: Analytics, Notifications & Admin Oversight
 *
 * Zod schemas for notification endpoints.
 */

import { z } from 'zod';

export const listNotificationsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  offset: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 0))
    .pipe(z.number().int().min(0)),
  unread_only: z
    .string()
    .optional()
    .transform((v) => v === 'true')
    .pipe(z.boolean()),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
