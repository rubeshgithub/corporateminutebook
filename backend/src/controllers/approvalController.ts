import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { Company } from '../models/Company';
import { CorporateEvent } from '../models/CorporateEvent';
import { User } from '../models/User';
import { ActivityLog } from '../models/ActivityLog';
import { serverError } from '../utils/apiError';
import { workspaceFor } from '../utils/workspace';
import { approvalDenial, reviewerTypeFor, type Actor, type ApprovalAction } from '../utils/approval';
import { APPROVAL_HISTORY_LIMIT } from '../services/approvalService';
import { generateMinuteBookPDF } from '../services/documentGenerator';
import { sendApprovalRequestEmail, sendApprovalDecisionEmail } from '../services/emailService';

const APP_URL = () => process.env.FRONTEND_URL || 'http://localhost:5173';

/** Statuses a CRS reviewer may open a personal book in. */
const REVIEWABLE = ['submitted', 'changes_requested', 'approved'];

/**
 * Loads the company for an approval action. Workspace members reach it
 * through their normal scope; a CRS reviewer (platform admin) reaches a
 * personal book without it, since reviewing is their job — but never a firm's.
 */
const loadForApproval = async (req: AuthRequest) => {
    const companyId = (req as any).validatedParams.id as string;
    const { ws, scope } = await workspaceFor(req);
    const me = await User.findById(ws.userId).select('name email role').lean();
    const actor: Actor = { ws, platformRole: me?.role ?? 'business_owner' };

    let company = await Company.findOne({ _id: companyId, ...scope, deletedAt: null });
    const hasAccess = !!company;
    if (!company && actor.platformRole === 'admin') {
        company = await Company.findOne({ _id: companyId, organizationId: null, deletedAt: null });
    }
    return { actor, company, hasAccess, me };
};

const displayName = (u?: { name?: string; email?: string } | null) => u?.name || u?.email || 'A colleague';

const applyTransition = (
    company: any,
    fields: Record<string, unknown>,
    entry: { action: string; by: string; note?: string },
) => {
    for (const [key, value] of Object.entries(fields)) company.set(`approval.${key}`, value);
    const history = [...((company.get('approval.history') as any[]) ?? []), { ...entry, at: new Date() }];
    company.set('approval.history', history.slice(-APPROVAL_HISTORY_LIMIT));
};

/** Email is a courtesy — an SES failure must not undo an approval decision. */
const notify = async (label: string, send: () => Promise<void>) => {
    try {
        await send();
    } catch (err: any) {
        console.error(`[approval] ${label} email failed:`, err?.message);
    }
};

const approvalView = (company: any) => ({
    companyId: company._id,
    approval:  company.approval ?? null,
});

const runAction = (action: ApprovalAction) => async (req: AuthRequest, res: Response) => {
    try {
        const { actor, company, hasAccess, me } = await loadForApproval(req);
        if (!company) return res.status(404).json({ error: 'Company not found.' });

        const denial = approvalDenial(action, actor, company, hasAccess);
        if (denial) return res.status(denial.httpStatus).json({ error: denial.error });

        const userId = actor.ws.userId;
        const note: string = req.body?.note ?? '';
        const now = new Date();

        if (action === 'submit') {
            applyTransition(company, {
                status: 'submitted', reviewerType: reviewerTypeFor(company),
                submittedAt: now, submittedBy: userId, reviewedAt: null, reviewedBy: null, note,
            }, { action: 'submitted', by: userId, note });
        } else if (action === 'approve') {
            applyTransition(company, {
                status: 'approved', reviewerType: reviewerTypeFor(company), reviewedAt: now, reviewedBy: userId, note,
            }, { action: 'approved', by: userId, note });
        } else if (action === 'request_changes') {
            applyTransition(company, {
                status: 'changes_requested', reviewedAt: now, reviewedBy: userId, note,
            }, { action: 'changes_requested', by: userId, note });
        } else {
            applyTransition(company, { status: 'draft', note: '' }, { action: 'reopened', by: userId, note });
        }
        await company.save();

        const verb = {
            submit: 'submitted for approval',
            approve: 'approved',
            request_changes: 'sent back for changes',
            reopen: 'reopened as a draft',
        }[action];
        await ActivityLog.create({
            userId,
            companyId: company._id,
            action: 'MINUTE_BOOK_APPROVAL',
            details: `Minute book for ${company.name} ${verb}.`,
        });

        const companyUrl = `${APP_URL()}/records/${company._id}`;
        if (action === 'submit') {
            const reviewers = company.organizationId
                ? await User.find({ organizationId: company.organizationId, organizationRole: 'supervisor', _id: { $ne: userId } }).select('email').lean()
                : await User.find({ role: 'admin' }).select('email').lean();
            await notify('approval request', () => sendApprovalRequestEmail({
                to: reviewers.map((r) => r.email),
                companyName: company.name,
                submitterName: displayName(me),
                reviewUrl: company.organizationId ? companyUrl : `${APP_URL()}/reviews`,
                note,
            }));
        } else if (action === 'approve' || action === 'request_changes') {
            const submitterId = company.get('approval.submittedBy');
            if (submitterId && String(submitterId) !== userId) {
                const submitter = await User.findById(submitterId).select('email').lean();
                if (submitter) {
                    await notify('approval decision', () => sendApprovalDecisionEmail({
                        to: submitter.email,
                        companyName: company.name,
                        reviewerName: company.organizationId ? displayName(me) : 'CRS review team',
                        decision: action === 'approve' ? 'approved' : 'changes_requested',
                        note,
                        companyUrl,
                    }));
                }
            }
        }

        return res.json(approvalView(company));
    } catch (error: any) {
        return serverError(res, `approval:${action}`, error);
    }
};

export const submitForApproval = runAction('submit');
export const approveMinuteBook = runAction('approve');
export const requestChanges = runAction('request_changes');
export const reopenMinuteBook = runAction('reopen');

// ─── CRS review queue (platform admins) ───────────────────────────────────────

/**
 * Checks the platform role on the User record, not the JWT claim: taking a
 * reviewer's access away must work at once, not after their token expires.
 */
export const requireCrsReviewer = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const user = await User.findById(req.user?.id).select('role').lean();
        if (user?.role !== 'admin') return res.status(403).json({ error: 'CRS reviewers only.' });
        return next();
    } catch (error: any) {
        return serverError(res, 'requireCrsReviewer', error);
    }
};

/** GET /api/reviews — personal minute books waiting for a CRS reviewer, oldest first. */
export const getReviewQueue = async (_req: AuthRequest, res: Response) => {
    try {
        const companies = await Company.find({ organizationId: null, 'approval.status': 'submitted', deletedAt: null })
            .select('name corporateAccessNumber businessNumber incorporationDate registeredOfficeAddress userId approval.submittedAt approval.submittedBy approval.note')
            .sort({ 'approval.submittedAt': 1 })
            .lean();
        const owners = await User.find({ _id: { $in: companies.map((c) => c.userId) } }).select('name email').lean();
        const ownerOf = (id: unknown) => owners.find((o) => String(o._id) === String(id));

        return res.json(companies.map((c) => ({
            _id:                   c._id,
            name:                  c.name,
            corporateAccessNumber: c.corporateAccessNumber,
            businessNumber:        c.businessNumber,
            incorporationDate:     c.incorporationDate,
            province:              c.registeredOfficeAddress?.province,
            owner:                 { name: ownerOf(c.userId)?.name, email: ownerOf(c.userId)?.email },
            submittedAt:           c.approval?.submittedAt,
            note:                  c.approval?.note,
        })));
    } catch (error: any) {
        return serverError(res, 'getReviewQueue', error);
    }
};

const loadReviewable = (id: string) =>
    Company.findOne({ _id: id, organizationId: null, 'approval.status': { $in: REVIEWABLE }, deletedAt: null });

/** GET /api/reviews/:id — the company record and its events, read-only, for review. */
export const getReviewCompany = async (req: AuthRequest, res: Response) => {
    try {
        const company = await loadReviewable((req as any).validatedParams.id);
        if (!company) return res.status(404).json({ error: 'Nothing to review for this company.' });
        const events = await CorporateEvent.find({ companyId: company._id, deletedAt: null }).sort({ effectiveDate: 1, recordedAt: 1 }).lean();
        return res.json({ company, events });
    } catch (error: any) {
        return serverError(res, 'getReviewCompany', error);
    }
};

/** POST /api/reviews/:id/minute-book — compile the book as the reviewer sees it (watermarked until approved). */
export const reviewMinuteBook = async (req: AuthRequest, res: Response) => {
    try {
        const company = await loadReviewable((req as any).validatedParams.id);
        if (!company) return res.status(404).json({ error: 'Nothing to review for this company.' });
        const events = await CorporateEvent.find({ companyId: company._id, deletedAt: null }).sort({ effectiveDate: 1, recordedAt: 1 }).lean();
        const pdf = await generateMinuteBookPDF(company, events);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=review-minute-book.pdf');
        return res.send(pdf);
    } catch (error: any) {
        return serverError(res, 'reviewMinuteBook', error);
    }
};
