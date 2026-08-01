import { Request, Response } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { CorporateEvent, CorporateEventType } from '../models/CorporateEvent';
import { CrsProcessedOrder } from '../models/CrsProcessedOrder';
import {
    isShareChangeEventType,
    shareChangeDataSchema,
    formatShareChangeIssues,
} from '../schemas/event.schema';

/**
 * POST /api/crs-feed/order-completed
 *
 * Called by the CRS webhook after every successful Stripe checkout. Materializes
 * (or updates) the corresponding MinuteBook Company + User records and appends
 * CorporateEvent entries so that over time the customer accumulates enough
 * corporate history in MinuteBook to make a minute-book upsell worthwhile.
 *
 * Security: HMAC-SHA256 over the raw request body, signed with the shared
 * CRS_FEED_SECRET env var. Header format matches Stripe's convention:
 *
 *   X-CRS-Signature: sha256=<hex-digest>
 *
 * Idempotency: every request carries the Stripe session_id as `orderId`. We
 * write it into CrsProcessedOrder after successful processing; replays of
 * the same orderId return 200 without re-creating anything.
 */

type IncomingEvent = {
    type:          CorporateEventType;
    effectiveDate: string;
    data?:         Record<string, unknown>;
};

type CrsFeedBody = {
    orderId:        string;
    service:        string;
    occurredAt?:    string;
    customerEmail:  string;
    customerName?:  string;
    company: {
        name:            string;
        registryId:      string;
        businessNumber?: string;
        jurisdiction:    string;      // "Alberta", "British Columbia", "Federal", …
        provinceKey:     string;      // "ab", "bc", "federal", …
        incorpDate?:     string;
        location?:       string;      // "Calgary, AB"
    };
    events?: IncomingEvent[];
};

const ALLOWED_EVENT_TYPES: CorporateEventType[] = [
    'director_appointed', 'director_resigned', 'director_address_changed',
    'address_changed', 'shares_issued', 'shares_transferred', 'shares_cancelled',
    'officer_appointed', 'officer_resigned', 'share_class_added',
    'annual_return_filed', 'fiscal_year_end_changed', 'name_changed',
    'voluntary_dissolution_filed', 'revival_filed',
];

/** Extract [city, province code] from a "City, XX" location string. */
function parseLocation(loc?: string): { city: string; province: string } {
    if (!loc) return { city: '', province: '' };
    const parts = loc.split(',').map((s) => s.trim());
    return { city: parts[0] ?? '', province: (parts[1] ?? '').toUpperCase() };
}

function timingSafeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
        return false;
    }
}

function verifySignature(rawBody: Buffer | undefined, header: string | undefined, secret: string): boolean {
    if (!rawBody || !header) return false;
    const provided = header.replace(/^sha256=/, '').trim();
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return timingSafeEqualHex(provided, expected);
}

function isValid(body: CrsFeedBody): string | null {
    if (!body?.orderId)                   return 'Missing orderId.';
    if (!body?.service)                   return 'Missing service.';
    if (!body?.customerEmail)             return 'Missing customerEmail.';
    if (!body?.company?.name)             return 'Missing company.name.';
    if (!body?.company?.registryId)       return 'Missing company.registryId.';
    if (!body?.company?.provinceKey)      return 'Missing company.provinceKey.';
    if (body.events) {
        for (const e of body.events) {
            if (!ALLOWED_EVENT_TYPES.includes(e.type)) return `Unknown event type: ${e.type}`;
            if (!e.effectiveDate)                       return 'Every event needs an effectiveDate.';
            // An unparseable date becomes an Invalid Date, which Mongoose
            // rejects at cast time — that aborts the transaction and returns a
            // 500, which CRS then retries forever. Reject it here as a 400 so
            // the retry loop stops on a bad payload.
            if (Number.isNaN(Date.parse(e.effectiveDate))) {
                return `Invalid effectiveDate on ${e.type} event: ${e.effectiveDate}`;
            }
            // Share events print their numbers straight into the compiled
            // minute book and share ledger, so hold them to the same rules the
            // main event API applies. Note we deliberately do NOT check
            // sharesClass against company.shareClasses the way the API path
            // can: a CRS-seeded company is created here with an empty
            // shareClasses array, so that check would reject every share event
            // on a brand-new company.
            if (isShareChangeEventType(e.type)) {
                const parsed = shareChangeDataSchema.safeParse(e.data ?? {});
                if (!parsed.success) {
                    return `Invalid data for ${e.type} event: ${formatShareChangeIssues(parsed.error)}`;
                }
            }
        }
    }
    return null;
}

export const orderCompleted = async (req: Request, res: Response) => {
    const secret = process.env.CRS_FEED_SECRET;
    if (!secret) {
        console.error('[crs-feed] CRS_FEED_SECRET is not configured');
        return res.status(500).json({ error: 'CRS feed is not configured.' });
    }

    // Raw body is stashed on req.rawBody by the express.json verify hook in
    // server.ts. Signature check must run against the exact bytes we received.
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    const signatureHeader = req.header('x-crs-signature') ?? undefined;
    if (!verifySignature(rawBody, signatureHeader, secret)) {
        return res.status(401).json({ error: 'Invalid signature.' });
    }

    const body = req.body as CrsFeedBody;
    const err = isValid(body);
    if (err) return res.status(400).json({ error: err });

    // Idempotency — Stripe retries webhook delivery on 5xx, and the CRS
    // webhook itself may retry the call to us. Bail out cleanly if we've
    // already processed this order.
    const already = await CrsProcessedOrder.findOne({ sessionId: body.orderId });
    if (already) {
        return res.status(200).json({
            received:      true,
            deduplicated:  true,
            userId:        already.userId,
            companyId:     already.companyId,
            eventsCreated: already.eventsCreated,
        });
    }

    const email = body.customerEmail.toLowerCase().trim();

    /**
     * Wrap the four correlated writes — User, Company, CorporateEvents,
     * CrsProcessedOrder — in a single Mongo transaction. Without it, a
     * mid-sequence failure (e.g. events save fails after Company save
     * succeeds) leaves orphaned records + doesn't record CrsProcessedOrder,
     * so the next webhook retry re-inserts the Company + creates duplicate
     * User records. With the transaction, either all four land or none do
     * — and Stripe's retry safely re-runs the same idempotent flow.
     *
     * `session.withTransaction` handles the commit/abort/retry lifecycle;
     * we just throw on any error and Mongo unwinds cleanly.
     */
    const session = await mongoose.startSession();
    let result: { userId: any; companyId: any; eventsCreated: number };
    try {
        result = await session.withTransaction(async () => {
            // Upsert user — either they already have a MinuteBook account
            // (self_signup) or we materialize a crs_seeded shell that OTP
            // login can later "claim".
            let user = await User.findOne({ email }).session(session);
            if (!user) {
                const [created] = await User.create([{
                    email,
                    name:             (body.customerName ?? '').trim(),
                    role:             'business_owner',
                    subscriptionTier: 'free',
                    origin:           'crs_seeded',
                    firstLoggedInAt:  null,
                }], { session });
                user = created;
            }

            // Upsert company by registrySignature. Scoped to this user so two
            // different MinuteBook accounts can each hold their own record
            // for the same real-world corporation without collisions.
            const registrySignature = {
                provinceKey: body.company.provinceKey,
                registryId:  body.company.registryId,
            };
            let company = await Company.findOne({
                userId:                          user._id,
                'registrySignature.provinceKey': registrySignature.provinceKey,
                'registrySignature.registryId':  registrySignature.registryId,
            }).session(session);

            if (!company) {
                const parsed = parseLocation(body.company.location);
                const [created] = await Company.create([{
                    userId:                user._id,
                    name:                  body.company.name,
                    corporateAccessNumber: body.company.registryId,
                    businessNumber:        body.company.businessNumber,
                    incorporationDate:     body.company.incorpDate ? new Date(body.company.incorpDate) : undefined,
                    registeredOfficeAddress: {
                        street:     '',
                        city:       parsed.city,
                        province:   parsed.province,
                        postalCode: '',
                        country:    'Canada',
                    },
                    recordsAddress:    { sameAsRegistered: true },
                    addressForService: { sameAsRegistered: true },
                    restrictions:      {},
                    authorizedBy: {
                        name:  (body.customerName ?? '').trim() || 'CRS Customer',
                        email,
                        phone: '',
                    },
                    schedules:         [],
                    shareClasses:      [],
                    directors:         [],
                    shareholders:      [],
                    officers:          [],
                    origin:            'crs_seeded',
                    crsCustomerEmail:  email,
                    claimedAt:         null,
                    registrySignature,
                }], { session });
                company = created;
            }

            // Create events. Empty payloads are legitimate (e.g. Good Standing
            // orders seed the company but have nothing to record). We still
            // write a CrsProcessedOrder so idempotency works for reorders.
            const eventsToCreate = (body.events ?? []).map((e) => ({
                companyId:     company!._id,
                userId:        user!._id,
                eventType:     e.type,
                effectiveDate: new Date(e.effectiveDate),
                recordedAt:    body.occurredAt ? new Date(body.occurredAt) : new Date(),
                data:          e.data ?? {},
                notes:         `From CRS order ${body.orderId} (${body.service}).`,
                attachments:   [],
                eSign:         { status: 'none' },
            }));
            const eventDocs = eventsToCreate.length
                ? await CorporateEvent.create(eventsToCreate, { session })
                : [];

            await CrsProcessedOrder.create([{
                sessionId:     body.orderId,
                service:       body.service,
                companyId:     company._id,
                userId:        user._id,
                eventsCreated: eventDocs.length,
                receivedAt:    new Date(),
            }], { session });

            return {
                userId:        user._id,
                companyId:     company._id,
                eventsCreated: eventDocs.length,
            };
        });
    } catch (e: any) {
        console.error('[crs-feed] transaction failed, rolling back:', e?.message ?? e);
        await session.endSession();
        return res.status(500).json({ error: 'Failed to process CRS order.' });
    }
    await session.endSession();

    return res.status(200).json({
        received:      true,
        userId:        result.userId,
        companyId:     result.companyId,
        eventsCreated: result.eventsCreated,
    });
};
