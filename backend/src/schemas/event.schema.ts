import { z } from 'zod';
import { objectId, isoDate, mediumString } from './common';

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

export const createEventSchema = z.object({
    companyId:     objectId,
    eventType:     eventTypeEnum,
    effectiveDate: isoDate,
    data:          eventDataObject.optional(),
    notes:         mediumString.optional(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z.object({
    effectiveDate: isoDate.optional(),
    data:          eventDataObject.optional(),
    notes:         mediumString.optional(),
});

export type UpdateEventInput = z.infer<typeof updateEventSchema>;
