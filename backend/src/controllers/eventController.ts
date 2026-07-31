import { Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../middleware/authMiddleware';
import { CorporateEvent, CorporateEventType } from '../models/CorporateEvent';
import { Company } from '../models/Company';
import { ActivityLog } from '../models/ActivityLog';
import { putFile, getFile } from '../services/uploadStorage';
import { generatePDFBuffer } from '../services/documentGenerator';
import { sendResolutionEmail } from '../services/emailService';
import { createESignRequest, getSubmissionStatus, createTemplateWithFields, createBuilderToken } from '../services/docusealService';

// ─── Multer: memory storage — bytes go to uploadStorage (S3 or disk) ─────────

// Files land in memory just long enough to hand off to uploadStorage.
// putFile decides where they actually persist (S3 in prod, local disk in
// dev) via the S3_ATTACHMENTS_BUCKET env var. Old diskStorage path was
// unsafe on Render — the container filesystem is wiped on every deploy.
export const eventAttachMiddleware = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 20 * 1024 * 1024 },
}).single('file');

function makeAttachmentFileId(originalName: string): string {
    return `evt_${uuidv4()}${path.extname(originalName)}`;
}

// ─── Resolution template mapping ─────────────────────────────────────────────

const RESOLUTION_TEMPLATES: Partial<Record<CorporateEventType, string>> = {
    director_appointed:         'resolution_director_change',
    director_resigned:          'resolution_director_change',
    director_address_changed:   'resolution_director_change',
    officer_appointed:          'resolution_director_change',
    officer_resigned:           'resolution_director_change',
    shares_issued:              'resolution_share_issuance',
    shares_transferred:         'resolution_share_transfer',
    shares_cancelled:           'resolution_share_issuance',
    share_class_added:          'resolution_share_issuance',
    address_changed:            'resolution_address_change',
    name_changed:               'resolution_name_change',
    fiscal_year_end_changed:    'resolution_name_change',
    // Wave 2:
    signing_authority_granted:  'resolution_signing_authority',
    signing_authority_revoked:  'resolution_signing_authority',
    dividend_declared:          'resolution_dividend_declaration',
};

// ─── Create event ─────────────────────────────────────────────────────────────

export const createEvent = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const { companyId, eventType, effectiveDate, data, notes } = req.body;

    if (!companyId || !eventType || !effectiveDate) {
        return res.status(400).json({ error: 'companyId, eventType, and effectiveDate are required.' });
    }

    // Ownership + existence check runs outside the transaction so we can 404
    // early without paying the session-start cost.
    const companyPreCheck = await Company.findOne({ _id: companyId, userId, deletedAt: null }).lean();
    if (!companyPreCheck) return res.status(404).json({ error: 'Company not found.' });

    // Event + company-snapshot are a single atomic unit. Without the
    // transaction, a failed company.save() leaves the event on record while
    // the snapshot never advances — the compliance summary and generated
    // minute book then disagree with the event log forever.
    const session = await mongoose.startSession();
    try {
        let createdEvent: any;
        await session.withTransaction(async () => {
            // Re-fetch inside the session so mutations are attached to it.
            const company = await Company.findOne({ _id: companyId, userId, deletedAt: null }).session(session);
            if (!company) throw new Error('Company not found.');

            const [event] = await CorporateEvent.create([{
                companyId,
                userId,
                eventType,
                effectiveDate: new Date(effectiveDate),
                data: data || {},
                notes,
            }], { session });

            applyEventToCompany(company, eventType as CorporateEventType, data || {}, new Date(effectiveDate));
            await company.save({ session });

            await ActivityLog.create([{
                userId,
                companyId,
                action: 'RECORDED_EVENT',
                details: `${eventType} recorded for ${company.name}.`,
            }], { session });

            createdEvent = event;
        });
        return res.status(201).json(createdEvent);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    } finally {
        await session.endSession();
    }
};

// ─── Get events for a company ─────────────────────────────────────────────────

export const getEvents = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { companyId } = req.params;

        const company = await Company.findOne({ _id: companyId, userId, deletedAt: null });
        if (!company) return res.status(404).json({ error: 'Company not found.' });

        // Filter out soft-deleted events. `deletedAt: null` includes docs
        // predating the field (Mongo treats missing = null in equality).
        const events = await CorporateEvent
            .find({ companyId, deletedAt: null })
            .sort({ effectiveDate: -1, recordedAt: -1 });
        return res.json(events);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

// ─── Update event (corrections; snapshot NOT re-applied) ─────────────────────

/**
 * PUT /api/events/:id — allow the user to correct notes, effective date, or
 * the event payload after the fact. We do NOT re-apply the delta to the
 * company snapshot: most events are lossy (they don't record the pre-state
 * they overwrote), so a safe re-apply isn't possible without a bigger
 * event-sourced refactor. Response includes a `snapshotWarning` flag when
 * the changes could materially affect state, so the UI can prompt the user
 * to also edit the company directly.
 */
export const updateEvent = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const id = String(req.params.id);
        const { notes, effectiveDate, data, registryFilingNotApplicable } = req.body ?? {};

        const event = await CorporateEvent.findById(id);
        if (!event || event.deletedAt) return res.status(404).json({ error: 'Event not found.' });

        // Ownership check via company.
        const company = await Company.findOne({ _id: event.companyId, userId, deletedAt: null });
        if (!company) return res.status(403).json({ error: 'Forbidden.' });

        let snapshotWarning = false;
        if (typeof notes === 'string' || notes === null) event.notes = notes || undefined;
        if (effectiveDate) {
            const d = new Date(effectiveDate);
            if (!Number.isNaN(d.getTime())) event.effectiveDate = d;
        }
        // Only mutate data if the caller sent an object. Any data change
        // could materially affect the company snapshot — warn.
        if (data && typeof data === 'object') {
            event.data = data;
            snapshotWarning = true;
        }
        if (typeof registryFilingNotApplicable === 'boolean') {
            event.registryFilingNotApplicable = registryFilingNotApplicable;
        }

        await event.save();
        await ActivityLog.create({
            userId,
            companyId: event.companyId,
            action: 'RECORDED_EVENT',
            details: `Event ${event.eventType} updated.`,
        });

        return res.json({
            event,
            snapshotWarning,
            snapshotMessage: snapshotWarning
                ? 'Company snapshot was not automatically re-applied. If this correction changes directors, shareholders, addresses or share structure, edit the company directly to keep the snapshot accurate.'
                : undefined,
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

// ─── Delete event (soft, does NOT rewind snapshot) ───────────────────────────

/**
 * DELETE /api/events/:id — soft-delete. Sets deletedAt and drops the event
 * from event listings + PDF compilation. Does NOT reverse the event's
 * effect on the company snapshot (same lossy-events reason as updateEvent).
 * Response carries `snapshotWarning: true` when the event was one of the
 * types that mutated company state, so the UI can steer the user to the
 * company editor.
 */
export const deleteEvent = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const id = String(req.params.id);

        const event = await CorporateEvent.findById(id);
        if (!event || event.deletedAt) return res.status(404).json({ error: 'Event not found.' });

        const company = await Company.findOne({ _id: event.companyId, userId, deletedAt: null });
        if (!company) return res.status(403).json({ error: 'Forbidden.' });

        event.deletedAt = new Date();
        await event.save();

        await ActivityLog.create({
            userId,
            companyId: event.companyId,
            action: 'RECORDED_EVENT',
            details: `Event ${event.eventType} deleted.`,
        });

        // Types that mutate company state — everything except annual_return_filed
        // (which only sets the filedThisPeriod flag derived from the event list).
        const mutatingTypes = new Set([
            'director_appointed', 'director_resigned', 'director_address_changed',
            'officer_appointed', 'officer_resigned',
            'address_changed', 'name_changed', 'fiscal_year_end_changed',
            'shares_issued', 'shares_transferred', 'shares_cancelled', 'share_class_added',
        ]);
        const snapshotWarning = mutatingTypes.has(event.eventType);

        return res.json({
            ok: true,
            snapshotWarning,
            snapshotMessage: snapshotWarning
                ? 'The event was removed from the log, but the company\'s current directors, shareholders, or address were not automatically rewound. If deleting this event should change the company state, edit the company directly.'
                : undefined,
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

// ─── Attach file to an event ─────────────────────────────────────────────────

export const attachEvent = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const id = String(req.params.id);
        const { role } = req.body;
        const file = (req as any).file as Express.Multer.File | undefined;

        if (!file) return res.status(400).json({ error: 'No file uploaded.' });
        if (!['resolution', 'registry_filing', 'supporting'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Use: resolution, registry_filing, or supporting.' });
        }

        const event = await CorporateEvent.findById(id);
        if (!event) return res.status(404).json({ error: 'Event not found.' });

        const company = await Company.findOne({ _id: event.companyId, userId, deletedAt: null });
        if (!company) return res.status(403).json({ error: 'Forbidden.' });

        // Persist the bytes via the storage layer (S3 in prod, disk in dev).
        // fileId is the durable identifier we store on the event and later
        // pass to getFile / fileExists — never a raw disk path.
        const fileId = makeAttachmentFileId(file.originalname);
        try {
            await putFile(fileId, file.buffer, file.mimetype);
        } catch (e: any) {
            console.error('[eventController] failed to persist attachment:', e?.message ?? e);
            return res.status(500).json({ error: 'Failed to save attachment. Please try again.' });
        }

        event.attachments.push({
            role,
            fileId,
            originalName: file.originalname,
            uploadedAt: new Date(),
        });
        await event.save();

        return res.json(event);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

// ─── Serve an attachment file ─────────────────────────────────────────────────

export const serveAttachment = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const id = String(req.params.id);
        const fileId = String(req.params.fileId);

        const event = await CorporateEvent.findById(id);
        if (!event) return res.status(404).json({ error: 'Event not found.' });

        const company = await Company.findOne({ _id: event.companyId, userId, deletedAt: null });
        if (!company) return res.status(403).json({ error: 'Forbidden.' });

        const attachment = event.attachments.find((a) => a.fileId === fileId);
        if (!attachment) return res.status(404).json({ error: 'Attachment not found.' });

        let bytes: Buffer;
        try {
            bytes = await getFile(fileId);
        } catch {
            return res.status(404).json({ error: 'File not found in storage.' });
        }

        res.setHeader('Content-Disposition', `attachment; filename="${attachment.originalName}"`);
        res.setHeader('Content-Type', 'application/pdf');
        return res.send(bytes);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

// ─── Generate resolution PDF for an event ────────────────────────────────────

export const generateResolution = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const id = String(req.params.id);

        const event = await CorporateEvent.findById(id);
        if (!event) return res.status(404).json({ error: 'Event not found.' });

        const company = await Company.findOne({ _id: event.companyId, userId, deletedAt: null });
        if (!company) return res.status(403).json({ error: 'Forbidden.' });

        const templateName = RESOLUTION_TEMPLATES[event.eventType];
        if (!templateName) {
            return res.status(400).json({ error: `No resolution template available for event type: ${event.eventType}` });
        }

        const pdfBuffer = await generatePDFBuffer(company, templateName, [], { event: event.toObject() });

        const safeName = company.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const safeType = event.eventType.replace(/_/g, '-');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${safeName}_${safeType}_resolution.pdf`);
        return res.send(pdfBuffer);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

// ─── Send resolution PDF by email ─────────────────────────────────────────────

const EVENT_LABELS: Partial<Record<CorporateEventType, string>> = {
    director_appointed:       'Director Appointed',
    director_resigned:        'Director Resigned',
    director_address_changed: "Director's Address Changed",
    officer_appointed:        'Officer Appointed',
    officer_resigned:         'Officer Resigned',
    shares_issued:            'Shares Issued',
    shares_transferred:       'Shares Transferred',
    shares_cancelled:         'Shares Cancelled',
    address_changed:          'Registered Address Changed',
    name_changed:             'Company Name Changed',
    share_class_added:        'Share Class Added',
    fiscal_year_end_changed:  'Fiscal Year End Changed',
};

export const sendResolution = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const id = String(req.params.id);
        const { recipientName, recipientEmail } = req.body;

        if (!recipientName || !recipientEmail)
            return res.status(400).json({ error: 'recipientName and recipientEmail are required.' });

        const event = await CorporateEvent.findById(id);
        if (!event) return res.status(404).json({ error: 'Event not found.' });

        const company = await Company.findOne({ _id: event.companyId, userId, deletedAt: null });
        if (!company) return res.status(403).json({ error: 'Forbidden.' });

        const templateName = RESOLUTION_TEMPLATES[event.eventType];
        if (!templateName)
            return res.status(400).json({ error: 'No resolution template for this event type.' });

        const pdfBuffer = await generatePDFBuffer(company, templateName, [], { event: event.toObject() });
        const safeName  = company.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const safeType  = event.eventType.replace(/_/g, '-');

        await sendResolutionEmail({
            to:           recipientEmail,
            recipientName,
            companyName:  company.name,
            eventLabel:   EVENT_LABELS[event.eventType] || event.eventType,
            pdfBuffer:    Buffer.from(pdfBuffer),
            pdfFilename:  `${safeName}_${safeType}_resolution_draft.pdf`,
        });

        return res.json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

// ─── Send resolution via DocuSeal e-signature ────────────────────────────────

export const sendForESign = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const id = String(req.params.id);
        const { recipientName, recipientEmail } = req.body;

        if (!recipientName || !recipientEmail)
            return res.status(400).json({ error: 'recipientName and recipientEmail are required.' });

        const event = await CorporateEvent.findById(id);
        if (!event) return res.status(404).json({ error: 'Event not found.' });

        const company = await Company.findOne({ _id: event.companyId, userId, deletedAt: null });
        if (!company) return res.status(403).json({ error: 'Forbidden.' });

        const templateName = RESOLUTION_TEMPLATES[event.eventType];
        if (!templateName)
            return res.status(400).json({ error: 'No resolution template for this event type.' });

        const pdfBuffer = await generatePDFBuffer(company, templateName, [], { event: event.toObject() });
        const safeName  = company.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const safeType  = event.eventType.replace(/_/g, '-');
        const docName   = `${safeName}_${safeType}_resolution`;

        const result = await createESignRequest({
            pdfBuffer:     Buffer.from(pdfBuffer),
            documentName:  docName,
            recipientName,
            recipientEmail,
        });

        event.eSign = {
            submissionId: result.submissionId,
            signingUrl:   result.signingUrl,
            status:       'pending',
            sentAt:       new Date(),
        };
        await event.save();

        return res.json(result);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

// ─── Get DocuSeal e-sign status for an event ─────────────────────────────────

export const getESignStatus = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const id = String(req.params.id);

        const event = await CorporateEvent.findById(id);
        if (!event) return res.status(404).json({ error: 'Event not found.' });

        const company = await Company.findOne({ _id: event.companyId, userId, deletedAt: null });
        if (!company) return res.status(403).json({ error: 'Forbidden.' });

        if (!event.eSign?.submissionId) {
            return res.json({ status: 'none' });
        }

        const data = await getSubmissionStatus(event.eSign.submissionId);
        const dsStatus: string = data.status || 'pending';
        const status = dsStatus === 'completed' ? 'completed'
                     : dsStatus === 'expired'   ? 'expired'
                     : 'pending';

        if (event.eSign.status !== status) {
            event.eSign.status = status as any;
            await event.save();
        }

        const downloadUrl: string = status === 'completed'
            ? (data.documents?.[0]?.url || '')
            : '';

        return res.json({
            status,
            signingUrl:   event.eSign.signingUrl || '',
            downloadUrl,
            submissionId: event.eSign.submissionId,
            sentAt:       event.eSign.sentAt,
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

// ─── Return a signed JWT for the DocuSeal embedded builder ───────────────────

export const getBuilderToken = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const id = String(req.params.id);
        const { recipientName, recipientEmail } = req.body;

        if (!recipientName || !recipientEmail)
            return res.status(400).json({ error: 'recipientName and recipientEmail are required.' });

        const docusealUserEmail = process.env.DOCUSEAL_USER_EMAIL;
        if (!docusealUserEmail)
            return res.status(500).json({ error: 'DOCUSEAL_USER_EMAIL is not set in environment variables.' });

        const event = await CorporateEvent.findById(id);
        if (!event) return res.status(404).json({ error: 'Event not found.' });

        const company = await Company.findOne({ _id: event.companyId, userId, deletedAt: null });
        if (!company) return res.status(403).json({ error: 'Forbidden.' });

        const templateName = RESOLUTION_TEMPLATES[event.eventType];
        if (!templateName)
            return res.status(400).json({ error: 'No resolution template for this event type.' });

        const pdfBuffer = await generatePDFBuffer(company, templateName, [], { event: event.toObject() });
        const safeName = company.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const safeType = event.eventType.replace(/_/g, '-');

        const templateId = await createTemplateWithFields(
            Buffer.from(pdfBuffer),
            `${safeName}_${safeType}_resolution`,
        );

        const token = createBuilderToken({
            templateId,
            userEmail:      docusealUserEmail,
            recipientName,
            recipientEmail,
        });

        return res.json({ token });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

// ─── Record a submission created by the DocuSeal builder ─────────────────────

export const recordESignResult = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const id = String(req.params.id);
        const { submissionId, signingUrl } = req.body;

        if (!submissionId) return res.status(400).json({ error: 'submissionId is required.' });

        const event = await CorporateEvent.findById(id);
        if (!event) return res.status(404).json({ error: 'Event not found.' });

        const company = await Company.findOne({ _id: event.companyId, userId, deletedAt: null });
        if (!company) return res.status(403).json({ error: 'Forbidden.' });

        event.eSign = {
            submissionId: Number(submissionId),
            signingUrl:   signingUrl || '',
            status:       'pending',
            sentAt:       new Date(),
        };
        await event.save();

        return res.json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

// ─── Dual-write: apply event to Company snapshot ───────────────────────────────

function applyEventToCompany(company: any, eventType: CorporateEventType, data: any, effectiveDate: Date): void {
    switch (eventType) {

        case 'director_appointed': {
            const fullName = [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' ').trim();
            const existing = company.directors.find((d: any) =>
                (d.firstName === data.firstName && d.lastName === data.lastName) ||
                d.name === fullName,
            );
            if (existing) {
                existing.resignedDate = undefined;
                existing.appointedDate = effectiveDate;
                if (data.address) existing.address = data.address;
                if (data.email) existing.email = data.email;
            } else {
                company.directors.push({
                    firstName: data.firstName || '',
                    middleName: data.middleName || '',
                    lastName: data.lastName || '',
                    name: fullName,
                    address: data.address || '',
                    residentCanadian: data.residentCanadian ?? true,
                    appointedDate: effectiveDate,
                    email: data.email || '',
                });
            }
            break;
        }

        case 'director_resigned': {
            const dir = company.directors.find((d: any) =>
                d._id?.toString() === data.directorId ||
                (d.firstName === data.firstName && d.lastName === data.lastName) ||
                d.name === data.directorName,
            );
            if (dir) dir.resignedDate = effectiveDate;
            break;
        }

        case 'director_address_changed': {
            const dir = company.directors.find((d: any) =>
                d._id?.toString() === data.directorId ||
                (d.firstName === data.firstName && d.lastName === data.lastName) ||
                d.name === data.directorName,
            );
            if (dir && data.newAddress) dir.address = data.newAddress;
            break;
        }

        case 'address_changed': {
            const fieldMap: Record<string, string> = {
                registered: 'registeredOfficeAddress',
                records: 'recordsAddress',
                service: 'addressForService',
            };
            const field = fieldMap[data.addressType];
            if (field && data.address) Object.assign(company[field], data.address);
            break;
        }

        case 'shares_issued': {
            const existing = company.shareholders.find((s: any) =>
                s.name === data.name && s.sharesClass === data.sharesClass,
            );
            if (existing) {
                existing.numberOfShares = (existing.numberOfShares || 0) + (data.numberOfShares || 0);
                if (data.considerationPaid != null) existing.considerationPaid = data.considerationPaid;
                if (data.email) existing.email = data.email;
            } else {
                const maxCert = company.shareholders.reduce(
                    (m: number, s: any) => Math.max(m, s.certificateNumber || 0), 0,
                );
                company.shareholders.push({
                    name: data.name,
                    holderType: data.holderType || 'Individual',
                    address: data.address || '',
                    sharesClass: data.sharesClass,
                    numberOfShares: data.numberOfShares || 0,
                    considerationPaid: data.considerationPaid,
                    issuanceDate: effectiveDate,
                    certificateNumber: data.certificateNumber || (maxCert + 1),
                    votingPercent: data.votingPercent,
                    corporateAccessNumber: data.corporateAccessNumber || '',
                    businessNumber: data.businessNumber || '',
                    email: data.email || '',
                });
            }
            break;
        }

        case 'shares_transferred': {
            const fromHolder = company.shareholders.find((s: any) =>
                s.name === data.fromName && s.sharesClass === data.sharesClass,
            );
            if (fromHolder) {
                fromHolder.numberOfShares = Math.max(0, (fromHolder.numberOfShares || 0) - (data.numberOfShares || 0));
            }
            const toHolder = company.shareholders.find((s: any) =>
                s.name === data.toName && s.sharesClass === data.sharesClass,
            );
            if (toHolder) {
                toHolder.numberOfShares = (toHolder.numberOfShares || 0) + (data.numberOfShares || 0);
                if (data.toEmail) toHolder.email = data.toEmail;
            } else {
                const maxCert = company.shareholders.reduce(
                    (m: number, s: any) => Math.max(m, s.certificateNumber || 0), 0,
                );
                company.shareholders.push({
                    name: data.toName,
                    holderType: data.toHolderType || 'Individual',
                    address: data.toAddress || '',
                    sharesClass: data.sharesClass,
                    numberOfShares: data.numberOfShares || 0,
                    issuanceDate: effectiveDate,
                    certificateNumber: maxCert + 1,
                    corporateAccessNumber: '',
                    businessNumber: '',
                    email: data.toEmail || '',
                });
            }
            break;
        }

        case 'shares_cancelled': {
            const holder = company.shareholders.find((s: any) =>
                s.name === data.holderName && s.sharesClass === data.sharesClass,
            );
            if (holder) {
                holder.numberOfShares = Math.max(0, (holder.numberOfShares || 0) - (data.numberOfShares || 0));
            }
            break;
        }

        case 'officer_appointed': {
            const existing = company.officers.find((o: any) =>
                o.name === data.name && o.title === data.title,
            );
            if (existing) {
                existing.resignedDate = undefined;
                existing.appointedDate = effectiveDate;
                if (data.email) existing.email = data.email;
            } else {
                company.officers.push({ name: data.name, title: data.title, appointedDate: effectiveDate, email: data.email || '' });
            }
            break;
        }

        case 'officer_resigned': {
            const officer = company.officers.find((o: any) =>
                o._id?.toString() === data.officerId || o.name === data.officerName,
            );
            if (officer) officer.resignedDate = effectiveDate;
            break;
        }

        case 'fiscal_year_end_changed': {
            if (data.newFiscalYearEnd) company.fiscalYearEnd = data.newFiscalYearEnd;
            break;
        }

        case 'name_changed': {
            if (data.newName) company.name = data.newName;
            break;
        }

        case 'share_class_added': {
            const exists = company.shareClasses.find((sc: any) => sc.name === data.name);
            if (!exists) {
                company.shareClasses.push({
                    name: data.name,
                    type: data.type || 'Common',
                    voting: data.voting ?? true,
                    maxAuthorized: data.maxAuthorized ?? null,
                    parValue: data.parValue ?? null,
                });
            }
            break;
        }

        // annual_return_filed: no Company snapshot update needed
        default: break;
    }
}
