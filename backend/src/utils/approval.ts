import type { Workspace } from './workspace';

export type ApprovalStatus = 'draft' | 'submitted' | 'changes_requested' | 'approved';
export type ReviewerType = 'firm_supervisor' | 'crs_reviewer';
export type ApprovalAction = 'submit' | 'approve' | 'request_changes' | 'reopen';

export interface ApprovalSubject {
    userId: unknown;
    organizationId?: unknown;
    approval?: { status?: ApprovalStatus | null } | null;
}

export interface Actor {
    ws: Workspace;
    /** Platform role from the User record — 'admin' is a CRS reviewer. */
    platformRole: string;
}

export interface ApprovalDenial {
    httpStatus: 403 | 404 | 409;
    error: string;
}

/**
 * Firm books are approved by the firm's supervisors; a business owner's
 * personal book is approved by a CRS reviewer.
 */
export const reviewerTypeFor = (company: ApprovalSubject): ReviewerType =>
    company.organizationId ? 'firm_supervisor' : 'crs_reviewer';

export const canReview = (actor: Actor, company: ApprovalSubject): boolean =>
    company.organizationId
        ? String(company.organizationId) === actor.ws.organizationId && actor.ws.organizationRole === 'supervisor'
        : actor.platformRole === 'admin';

/**
 * Whether compiled output carries the DRAFT watermark. Companies created
 * before approvals existed have no status and print as they always did.
 */
export const isDraftOutput = (company: ApprovalSubject): boolean => {
    const status = company.approval?.status;
    return !!status && status !== 'approved';
};

/** Content edits send an approved or in-review book back to draft. */
export const EDIT_RESETS_FROM: ApprovalStatus[] = ['approved', 'submitted'];

const NOT_FOUND: ApprovalDenial = { httpStatus: 404, error: 'Company not found.' };

const OWN_BOOK: ApprovalDenial = {
    httpStatus: 403,
    error: 'You cannot review your own minute book. Another CRS reviewer must review it.',
};

/** A CRS reviewer who also owns the personal company must not decide on it. */
const reviewingOwnBook = (actor: Actor, company: ApprovalSubject): boolean =>
    reviewerTypeFor(company) === 'crs_reviewer' && String(company.userId) === actor.ws.userId;

/**
 * Null when `actor` may take `action` on `company`, otherwise why not.
 * `hasAccess` is whether the company is inside the actor's own workspace
 * scope; a CRS reviewer reaches personal books without it, but only to review.
 */
export const approvalDenial = (
    action: ApprovalAction,
    actor: Actor,
    company: ApprovalSubject,
    hasAccess: boolean,
): ApprovalDenial | null => {
    const status: ApprovalStatus = company.approval?.status ?? 'draft';
    const reviewer = canReview(actor, company);
    const reviewerType = reviewerTypeFor(company);

    switch (action) {
        case 'submit':
            if (!hasAccess) return NOT_FOUND;
            if (status === 'submitted') return { httpStatus: 409, error: 'This minute book is already waiting for review.' };
            if (status === 'approved') return { httpStatus: 409, error: 'This minute book is already approved. Reopen it to make changes.' };
            return null;

        case 'approve':
            if (!hasAccess && !reviewer) return NOT_FOUND;
            if (!reviewer) {
                return {
                    httpStatus: 403,
                    error: reviewerType === 'firm_supervisor'
                        ? 'Only a firm supervisor can approve this minute book.'
                        : 'A CRS reviewer approves this minute book. Submit it for review.',
                };
            }
            if (reviewingOwnBook(actor, company)) return OWN_BOOK;
            if (status === 'approved') return { httpStatus: 409, error: 'This minute book is already approved.' };
            // A supervisor may sign off their own draft directly (the
            // supervising lawyer's approval); a CRS reviewer only decides on
            // what the owner submitted.
            if (reviewerType === 'crs_reviewer' && status !== 'submitted') {
                return { httpStatus: 409, error: 'Only a minute book submitted for review can be approved.' };
            }
            return null;

        case 'request_changes':
            if (!hasAccess && !reviewer) return NOT_FOUND;
            if (!reviewer) return { httpStatus: 403, error: 'Only the reviewer can send this minute book back for changes.' };
            if (reviewingOwnBook(actor, company)) return OWN_BOOK;
            if (status !== 'submitted') return { httpStatus: 409, error: 'Only a minute book waiting for review can be sent back.' };
            return null;

        case 'reopen':
            if (!hasAccess && !reviewer) return NOT_FOUND;
            if (status !== 'approved' && status !== 'submitted') {
                return { httpStatus: 409, error: 'Only an approved or submitted minute book can be reopened.' };
            }
            return null;
    }
};
