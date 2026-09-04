import { z } from 'zod';
import { emailField } from './common';

/**
 * Account-level write contracts. Both endpoints sit behind the session
 * cookie; these schemas are the second factor — a typed-out email for the
 * irreversible one, a real boolean for the preference toggle.
 */

/** DELETE /api/auth/account — the caller must retype the account email. */
export const deleteAccountSchema = z.object({
    confirmEmail: emailField,
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

/** PATCH /api/auth/preferences — CASL reminder opt-out, in-app counterpart
 *  to the emailed unsubscribe link. */
export const updatePreferencesSchema = z.object({
    reminderOptOut: z.boolean(),
});

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
