import { Request, Response } from 'express';
import crypto from 'crypto';
import { AuthRequest } from '../middleware/authMiddleware';
import { CompanyShare } from '../models/CompanyShare';
import { Company } from '../models/Company';
import { CorporateEvent } from '../models/CorporateEvent';
import { User } from '../models/User';
import { ActivityLog } from '../models/ActivityLog';
import { generateMinuteBookPDF } from '../services/documentGenerator';
import { sendShareInviteEmail } from '../services/emailService';
import { serverError } from '../utils/apiError';
import { viewerCompany, viewerEvents, redactedForViewer } from '../utils/shareRedaction';

const APP_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/** URL-safe base62 token, 32 chars — same shape as the CRS side. */
function newToken(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(32);
    let out = '';
    for (let i = 0; i < 32; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
}

function shareUrlFor(token: string): string {
    return `${APP_URL}/share/${token}`;
}

/* ═══════════════ Owner-facing endpoints (authenticated) ═══════════════ */

/**
 * POST /api/companies/:id/shares
 *
 * Body: { label?, invitedEmail?, expiresInDays? = 7 }
 *
 * Creates a share token. When invitedEmail is present we also fire off an
 * email delivering the URL. Owner-scoped: only the company owner can share.
 */
export const createShare = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const companyId = String(req.params.id);
        const { label, invitedEmail, expiresInDays = 7 } = req.body ?? {};

        const company = await Company.findOne({ _id: companyId, userId, deletedAt: null });
        if (!company) return res.status(404).json({ error: 'Company not found.' });

        // Cap: sanity-check the caller isn't asking for a 10-year share.
        const days = Math.max(1, Math.min(90, Number(expiresInDays) || 7));
        const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

        const share = await CompanyShare.create({
            companyId,
            createdBy: userId,
            token:     newToken(),
            label:     typeof label === 'string' ? label.trim().slice(0, 120) : undefined,
            invitedEmail: typeof invitedEmail === 'string' && invitedEmail.trim()
                ? invitedEmail.trim().toLowerCase()
                : undefined,
            permission: 'viewer',
            expiresAt,
        });

        // Fire the invite email if this share was created as an email delivery.
        if (share.invitedEmail) {
            try {
                const inviter = await User.findById(userId).select('name email').lean();
                await sendShareInviteEmail({
                    to:          share.invitedEmail,
                    inviterName: inviter?.name || inviter?.email || 'Someone',
                    companyName: company.name,
                    shareUrl:    shareUrlFor(share.token),
                    label:       share.label,
                    expiresAt,
                });
            } catch (e: any) {
                // Email failure shouldn't undo the share — owner can copy the URL manually.
                console.error(`[share] invite email failed for ${share.invitedEmail}:`, e?.message ?? e);
            }
        }

        await ActivityLog.create({
            userId,
            companyId,
            action:  'UPDATED_COMPANY',
            details: share.invitedEmail
                ? `Shared ${company.name} with ${share.invitedEmail}.`
                : `Created public share link for ${company.name}.`,
        });

        return res.status(201).json({
            id:            share._id,
            token:         share.token,
            url:           shareUrlFor(share.token),
            label:         share.label,
            invitedEmail:  share.invitedEmail,
            expiresAt:     share.expiresAt,
            createdAt:     share.createdAt,
        });
    } catch (error: any) {
        return serverError(res, 'createShare', error);
    }
};

/**
 * GET /api/companies/:id/shares — active shares for this company. Owner only.
 * Includes revoked and expired for reference but flags them.
 */
export const listShares = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const companyId = String(req.params.id);
        const company = await Company.findOne({ _id: companyId, userId, deletedAt: null }).lean();
        if (!company) return res.status(404).json({ error: 'Company not found.' });

        const shares = await CompanyShare.find({ companyId }).sort({ createdAt: -1 }).lean();
        const now = new Date();
        return res.json(shares.map((s) => ({
            id:            s._id,
            token:         s.token,
            url:           shareUrlFor(s.token),
            label:         s.label,
            invitedEmail:  s.invitedEmail,
            expiresAt:     s.expiresAt,
            revokedAt:     s.revokedAt,
            lastAccessedAt: s.lastAccessedAt,
            accessCount:   s.accessCount,
            createdAt:     s.createdAt,
            status:        s.revokedAt ? 'revoked'
                          : s.expiresAt < now ? 'expired'
                          : 'active',
        })));
    } catch (error: any) {
        return serverError(res, 'listShares', error);
    }
};

/**
 * DELETE /api/shares/:shareId — revoke a share. Owner only. Idempotent.
 */
export const revokeShare = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const shareId = String(req.params.shareId);

        const share = await CompanyShare.findById(shareId);
        if (!share) return res.status(404).json({ error: 'Share not found.' });

        // Ownership check via the company.
        const company = await Company.findOne({ _id: share.companyId, userId, deletedAt: null });
        if (!company) return res.status(403).json({ error: 'Forbidden.' });

        if (!share.revokedAt) {
            share.revokedAt = new Date();
            await share.save();
        }
        return res.json({ ok: true });
    } catch (error: any) {
        return serverError(res, 'revokeShare', error);
    }
};

/* ═══════════════ Public token-resolve endpoints (NO auth) ═══════════════ */

/**
 * Common helper: resolve a token to an active, non-revoked, non-expired share.
 * Returns the share + its company, or null with an appropriate status message.
 */
async function resolveShare(token: string): Promise<
    | { status: 'ok'; share: any; company: any }
    | { status: 'not_found' }
    | { status: 'revoked' }
    | { status: 'expired' }
> {
    if (!token || !/^[A-Za-z0-9]{16,64}$/.test(token)) return { status: 'not_found' };
    const share = await CompanyShare.findOne({ token });
    if (!share) return { status: 'not_found' };
    if (share.revokedAt) return { status: 'revoked' };
    if (share.expiresAt < new Date()) return { status: 'expired' };
    const company = await Company.findOne({ _id: share.companyId, deletedAt: null }).lean();
    if (!company) return { status: 'not_found' };
    return { status: 'ok', share, company };
}

/**
 * GET /api/share/:token — public read-only view. Returns the company data
 * (viewer projection) + events (soft-delete filtered) shaped for the
 * shared-view SPA page. Access logging tracks who's consuming the link.
 * The projections live in utils/shareRedaction.ts — the share token is the
 * only credential here, so what they allow through is the whole security
 * story of this endpoint.
 */
export const resolveShareEndpoint = async (req: Request, res: Response) => {
    try {
        const token = String(req.params.token);
        const r = await resolveShare(token);

        if (r.status === 'not_found') return res.status(404).json({ error: 'Share link not found.' });
        if (r.status === 'revoked')   return res.status(410).json({ error: 'This share link has been revoked.' });
        if (r.status === 'expired')   return res.status(410).json({ error: 'This share link has expired.' });

        // Best-effort access log — never blocks the response.
        CompanyShare.updateOne({ _id: r.share._id }, {
            $set: { lastAccessedAt: new Date() },
            $inc: { accessCount: 1 },
        }).catch(() => {});

        const events = await CorporateEvent.find({ companyId: r.company._id, deletedAt: null })
            .sort({ effectiveDate: -1, recordedAt: -1 })
            .lean();

        return res.json({
            company: viewerCompany(r.company),
            events:  viewerEvents(events),
            share: {
                label:      r.share.label,
                expiresAt:  r.share.expiresAt,
                createdAt:  r.share.createdAt,
            },
        });
    } catch (error: any) {
        return serverError(res, 'resolveShareEndpoint', error);
    }
};

/**
 * GET /api/share/:token/minute-book — streams the compiled minute book PDF
 * for the shared company. Same PDF pipeline as the owner's compile, but
 * bypasses ownership + the compliance-gap gate, and renders from the
 * viewer-redacted projection (see redactedForViewer).
 */
export const shareMinuteBookEndpoint = async (req: Request, res: Response) => {
    try {
        const token = String(req.params.token);
        const r = await resolveShare(token);
        if (r.status !== 'ok') {
            return res.status(r.status === 'not_found' ? 404 : 410).json({ error: 'Share link is no longer available.' });
        }

        const rawEvents = await CorporateEvent.find({ companyId: r.company._id, deletedAt: null })
            .sort({ effectiveDate: 1, recordedAt: 1 })
            .lean();
        const { company, events } = redactedForViewer(r.company, rawEvents);
        // Cast — the Company model instance is needed by the PDF pipeline;
        // .lean() returns a plain object which works because the template
        // reads properties without invoking Mongoose methods.
        const pdfBuffer = await generateMinuteBookPDF(company as any, events);

        CompanyShare.updateOne({ _id: r.share._id }, {
            $set: { lastAccessedAt: new Date() },
            $inc: { accessCount: 1 },
        }).catch(() => {});

        const safeName = (r.company.name as string).replace(/[^a-z0-9]/gi, '_').toLowerCase();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${safeName}_minute_book.pdf`);
        return res.send(pdfBuffer);
    } catch (error: any) {
        console.error('[share] minute-book generation failed:', error);
        return res.status(500).json({ error: 'Failed to generate the minute book.' });
    }
};
