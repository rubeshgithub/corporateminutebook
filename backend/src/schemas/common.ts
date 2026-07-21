import { z } from 'zod';

/**
 * Reusable primitives + tight length caps so a single request can't push
 * megabytes of text into a Mongo document. Every string field on the API's
 * write surface should use one of these instead of raw z.string().
 */

export const shortString = z.string().trim().max(120);      // names, single-line labels
export const mediumString = z.string().trim().max(500);     // titles, single-paragraph
export const longString = z.string().trim().max(5000);      // descriptions, purposes, notes

export const emailField = z.string().trim().toLowerCase().email().max(254);
export const phoneField = z.string().trim().max(30);
export const postalField = z.string().trim().max(20);

/** MongoDB ObjectId — 24 hex chars. Anything else is a client bug or attack. */
export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id.');

/** ISO-8601 date — coerced to a Date instance so downstream code doesn't reparse. */
export const isoDate = z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid date.' })
    .transform((s) => new Date(s));

/** Optional isoDate that also accepts null (Mongoose treats null as unset). */
export const optionalIsoDate = z
    .union([
        z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid date.' }).transform((s) => new Date(s)),
        z.null(),
        z.undefined(),
    ])
    .optional();

export const canadianJurisdictionCode = z.enum([
    'ab', 'bc', 'mb', 'nb', 'nl', 'ns', 'nt', 'nu',
    'on', 'pe', 'qc', 'sk', 'yt', 'federal',
]);

/** Address block, permissive for the several nested address shapes on Company. */
export const addressBlock = z.object({
    street:     shortString.optional(),
    city:       shortString.optional(),
    province:   shortString.optional(),
    postalCode: postalField.optional(),
    country:    shortString.optional(),
});
