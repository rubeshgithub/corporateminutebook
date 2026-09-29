import { z } from 'zod';
import { emailField, objectId, shortString } from './common';

/** Firm workspace write contracts. Every route sits behind the session cookie. */

const firmName = shortString.min(1, 'Firm name is required.');
const firmRole = z.enum(['supervisor', 'member']);

/** POST /api/organization — create a firm; the caller becomes its first supervisor. */
export const createOrganizationSchema = z.object({ name: firmName });

/** PATCH /api/organization — rename (supervisor only). */
export const renameOrganizationSchema = z.object({ name: firmName });

/** POST /api/organization/invites — invite by email (supervisor only). */
export const createInviteSchema = z.object({
    email: emailField,
    role:  firmRole.default('member'),
});

/** PATCH /api/organization/members/:userId — change a member's role (supervisor only). */
export const updateMemberRoleSchema = z.object({ role: firmRole });

export const userIdParam = z.object({ userId: objectId });
export const inviteIdParam = z.object({ inviteId: objectId });
export const organizationIdParam = z.object({ organizationId: objectId });

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
