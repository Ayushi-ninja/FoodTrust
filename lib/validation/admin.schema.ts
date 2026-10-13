/**
 * lib/validation/admin.schema.ts
 * FoodTrust — Phase 9: Analytics, Notifications & Admin Oversight
 *
 * Zod schemas for admin user management, audit log, and config endpoints.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Admin: List Users
// ---------------------------------------------------------------------------
export const listUsersQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 50))
    .pipe(z.number().int().min(1).max(200)),
  offset: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 0))
    .pipe(z.number().int().min(0)),
  role: z
    .enum(['DONOR', 'NGO', 'ADMIN', 'SUPER_ADMIN', 'DEVICE'])
    .optional(),
  status: z
    .enum(['ACTIVE', 'PENDING', 'SUSPENDED'])
    .optional(),
  search: z.string().max(100).optional(),
});

// ---------------------------------------------------------------------------
// Admin: Update User
// ---------------------------------------------------------------------------
export const updateUserBodySchema = z
  .object({
    status: z.enum(['ACTIVE', 'PENDING', 'SUSPENDED']).optional(),
    role: z.enum(['DONOR', 'NGO', 'ADMIN', 'SUPER_ADMIN', 'DEVICE']).optional(),
  })
  .refine((data) => data.status !== undefined || data.role !== undefined, {
    message: 'At least one of status or role must be provided.',
  });

// ---------------------------------------------------------------------------
// Admin: List Audit Logs
// ---------------------------------------------------------------------------
export const listAuditLogsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 50))
    .pipe(z.number().int().min(1).max(200)),
  offset: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 0))
    .pipe(z.number().int().min(0)),
  actor_id: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  target_table: z.string().max(50).optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Admin: Update Config
// ---------------------------------------------------------------------------
const ALLOWLISTED_CONFIG_KEYS = ['kg_per_meal_factor', 'co2_factor_per_kg'] as const;

export const updateConfigBodySchema = z.object({
  key: z.enum(ALLOWLISTED_CONFIG_KEYS),
  value: z
    .string()
    .refine(
      (v) => {
        const n = parseFloat(v);
        return Number.isFinite(n) && n > 0;
      },
      { message: 'Config value must be a positive finite number string.' }
    ),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
export type UpdateConfigBody = z.infer<typeof updateConfigBodySchema>;
export type AllowlistedConfigKey = typeof ALLOWLISTED_CONFIG_KEYS[number];
