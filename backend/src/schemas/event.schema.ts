import { z } from 'zod';
import { objectId, isoDate, mediumString, shortString } from './common';

/**
 * Event-type enum mirrors backend/src/models/CorporateEvent.ts. Kept as a
 * literal list rather than importing the model so this schema stays a pure
 * boundary contract — no coupling to Mongoose types.
 */
export const eventTypeEnum = z.enum([
    'director_appointed',
    'director_resigned',
    'director_address_changed',
    'officer_appointed',
    'officer_resigned',
    'address_changed',
    'shares_issued',
    'shares_transferred',
    'shares_cancelled',
    'share_class_added',
    'annual_return_filed',
    'fiscal_year_end_changed',
    'name_changed',
    'voluntary_dissolution_filed',
    'revival_filed',
    'signing_authority_granted',
    'signing_authority_revoked',
    'dividend_declared',
]);

/**
 * Loose object for event `data` — the shape varies per event type and the
 * controller re-interprets it inside `applyEventToCompany`. We only cap the
 * total size and reject non-object payloads so no one can push a 10 MB blob
 * or a naked string into the DB.
 */
const eventDataObject = z
    .record(z.string(), z.unknown())
    .refine((obj) => JSON.stringify(obj).length <= 32_000, {
        message: 'Event data too large (max 32 KB).',
    });

/**
 * The three event types whose `data` carries share counts. Unlike most event
 * payloads — which are read back as free text — these numbers are printed into
 * the compiled minute book, the share ledger, and the share transfer register,
 * so a malformed payload isn't a crash, it's a wrong figure in a legal record.
 * Every entry point that accepts one of these should validate with
 * `shareChangeDataSchema` below.
 */
export const SHARE_CHANGE_EVENT_TYPES = [
    'shares_issued',
    'shares_transferred',
    'shares_cancelled',
] as const;

export type ShareChangeEventType = (typeof SHARE_CHANGE_EVENT_TYPES)[number];

export function isShareChangeEventType(type: string): type is ShareChangeEventType {
    return (SHARE_CHANGE_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Loose rather than strict on purpose: the rest of a share-change payload
 * varies by type — `name` for an issuance, `fromName`/`toName` for a transfer,
 * `holderName` for a cancellation, plus optional address / email / certificate
 * fields that `applyEventToCompany` reads directly. We pin only the two fields
 * every share change must have and pass everything else through untouched.
 */
export const shareChangeDataSchema = z.looseObject({
    // Messages are written for the person filling in the form, and match the
    // client-side wording in RecordEventDialog so the same mistake reads the
    // same whether it is caught before or after the round-trip.
    numberOfShares: z
        .number({ error: 'Number of shares must be a whole number of at least 1.' })
        .int('Number of shares must be a whole number of at least 1.')
        .positive('Number of shares must be a whole number of at least 1.'),
    sharesClass: shortString.min(1, 'Share class is required.'),
});

/** Flatten a share-data ZodError into one line suitable for an API message. */
export function formatShareChangeIssues(error: z.ZodError): string {
    return error.issues
        .map((i) => `${i.path.join('.') || 'data'}: ${i.message}`)
        .join('; ');
}

export const createEventSchema = z.object({
    companyId:     objectId,
    eventType:     eventTypeEnum,
    effectiveDate: isoDate,
    data:          eventDataObject.optional(),
    notes:         mediumString.optional(),
}).superRefine((body, ctx) => {
    // `data` is deliberately loose for most event types, but a share change
    // has to carry a usable count and class — those get printed into the
    // ledger. Re-issue each failure under a `data.*` path so the client sees
    // which field is wrong rather than a bare "invalid body".
    if (!isShareChangeEventType(body.eventType)) return;
    const parsed = shareChangeDataSchema.safeParse(body.data ?? {});
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
        ctx.addIssue({
            code:    z.ZodIssueCode.custom,
            path:    ['data', ...issue.path],
            message: issue.message,
        });
    }
});

export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z.object({
    effectiveDate:               isoDate.optional(),
    data:                        eventDataObject.optional(),
    notes:                       mediumString.optional(),
    // "This event doesn't require a separate registry filing" —
    // e.g. founding events, or shareholders in provinces where the
    // registry doesn't track them. Toggled from the UI. When true,
    // compliance summary + gap detection treat the event as satisfied.
    registryFilingNotApplicable: z.boolean().optional(),
});

export type UpdateEventInput = z.infer<typeof updateEventSchema>;
