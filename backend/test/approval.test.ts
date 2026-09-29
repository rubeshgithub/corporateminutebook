import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import { approvalDenial, canReview, isDraftOutput, reviewerTypeFor, type Actor } from '../src/utils/approval';
import { stampDraftWatermark } from '../src/services/documentGenerator';
import { requestChangesSchema } from '../src/schemas/approval.schema';

const FIRM = 'ffffffffffffffffffffffff';
const OTHER_FIRM = 'eeeeeeeeeeeeeeeeeeeeeeee';
const OWNER = 'aaaaaaaaaaaaaaaaaaaaaaaa';

const supervisor: Actor = { ws: { userId: 'sup', organizationId: FIRM, organizationRole: 'supervisor' }, platformRole: 'business_owner' };
const assistant: Actor = { ws: { userId: 'asst', organizationId: FIRM, organizationRole: 'member' }, platformRole: 'business_owner' };
const otherSupervisor: Actor = { ws: { userId: 'x', organizationId: OTHER_FIRM, organizationRole: 'supervisor' }, platformRole: 'business_owner' };
const owner: Actor = { ws: { userId: OWNER, organizationId: null, organizationRole: null }, platformRole: 'business_owner' };
const crsReviewer: Actor = { ws: { userId: 'crs', organizationId: null, organizationRole: null }, platformRole: 'admin' };

const firmBook = (status?: any) => ({ userId: 'asst', organizationId: FIRM, approval: status ? { status } : undefined });
const personalBook = (status?: any) => ({ userId: OWNER, organizationId: null, approval: status ? { status } : undefined });

describe('who reviews', () => {
    it('routes firm books to the firm supervisor and personal books to CRS', () => {
        expect(reviewerTypeFor(firmBook())).toBe('firm_supervisor');
        expect(reviewerTypeFor(personalBook())).toBe('crs_reviewer');
    });

    it('lets only that firm\'s supervisors review a firm book', () => {
        expect(canReview(supervisor, firmBook())).toBe(true);
        expect(canReview(assistant, firmBook())).toBe(false);
        expect(canReview(otherSupervisor, firmBook())).toBe(false);
        expect(canReview(crsReviewer, firmBook())).toBe(false);
    });

    it('lets only CRS reviewers review a personal book — never the owner', () => {
        expect(canReview(crsReviewer, personalBook())).toBe(true);
        expect(canReview(owner, personalBook())).toBe(false);
        expect(canReview(supervisor, personalBook())).toBe(false);
    });
});

describe('firm workflow', () => {
    it('lets an assistant submit but not approve', () => {
        expect(approvalDenial('submit', assistant, firmBook('draft'), true)).toBeNull();
        expect(approvalDenial('approve', assistant, firmBook('submitted'), true)?.httpStatus).toBe(403);
    });

    it('lets a supervisor approve a submitted book', () => {
        expect(approvalDenial('approve', supervisor, firmBook('submitted'), true)).toBeNull();
    });

    it('lets a supervisor sign off their own draft directly', () => {
        expect(approvalDenial('approve', supervisor, firmBook('draft'), true)).toBeNull();
        expect(approvalDenial('approve', supervisor, firmBook('changes_requested'), true)).toBeNull();
    });

    it('refuses to submit a book already waiting or already approved', () => {
        expect(approvalDenial('submit', assistant, firmBook('submitted'), true)?.httpStatus).toBe(409);
        expect(approvalDenial('submit', assistant, firmBook('approved'), true)?.httpStatus).toBe(409);
    });

    it('only sends back a book that is actually waiting for review', () => {
        expect(approvalDenial('request_changes', supervisor, firmBook('submitted'), true)).toBeNull();
        expect(approvalDenial('request_changes', supervisor, firmBook('draft'), true)?.httpStatus).toBe(409);
    });

    it('hides a firm book from another firm\'s supervisor entirely', () => {
        expect(approvalDenial('approve', otherSupervisor, firmBook('submitted'), false)?.httpStatus).toBe(404);
    });

    it('lets anyone with access withdraw a submission or reopen an approval', () => {
        expect(approvalDenial('reopen', assistant, firmBook('submitted'), true)).toBeNull();
        expect(approvalDenial('reopen', assistant, firmBook('approved'), true)).toBeNull();
        expect(approvalDenial('reopen', assistant, firmBook('draft'), true)?.httpStatus).toBe(409);
    });
});

describe('business owner workflow', () => {
    it('lets the owner submit but never approve their own book', () => {
        expect(approvalDenial('submit', owner, personalBook('draft'), true)).toBeNull();
        expect(approvalDenial('approve', owner, personalBook('submitted'), true)?.httpStatus).toBe(403);
    });

    it('treats a book with no approval record (pre-existing company) as a draft to submit', () => {
        expect(approvalDenial('submit', owner, personalBook(), true)).toBeNull();
    });

    it('lets a CRS reviewer approve only what the owner submitted', () => {
        expect(approvalDenial('approve', crsReviewer, personalBook('submitted'), false)).toBeNull();
        expect(approvalDenial('approve', crsReviewer, personalBook('draft'), false)?.httpStatus).toBe(409);
    });

    it('stops a CRS reviewer approving or sending back their own personal book', () => {
        const reviewersOwnBook = { userId: 'crs', organizationId: null, approval: { status: 'submitted' as const } };
        expect(approvalDenial('approve', crsReviewer, reviewersOwnBook, true)?.httpStatus).toBe(403);
        expect(approvalDenial('request_changes', crsReviewer, reviewersOwnBook, true)?.httpStatus).toBe(403);
    });

    it('does not let a CRS reviewer submit on the owner\'s behalf', () => {
        expect(approvalDenial('submit', crsReviewer, personalBook('draft'), false)?.httpStatus).toBe(404);
    });
});

describe('DRAFT watermark rule', () => {
    it('marks draft, submitted and changes-requested books', () => {
        expect(isDraftOutput(firmBook('draft'))).toBe(true);
        expect(isDraftOutput(firmBook('submitted'))).toBe(true);
        expect(isDraftOutput(firmBook('changes_requested'))).toBe(true);
    });

    it('does not mark approved books', () => {
        expect(isDraftOutput(firmBook('approved'))).toBe(false);
    });

    it('leaves companies created before approvals existed unmarked', () => {
        expect(isDraftOutput(personalBook())).toBe(false);
    });
});

describe('stampDraftWatermark', () => {
    it('writes DRAFT and the warning line onto every page', async () => {
        const doc = await PDFDocument.create();
        doc.addPage([612, 792]);
        doc.addPage([792, 612]);
        await stampDraftWatermark(doc);

        const parser = new PDFParse({ data: Buffer.from(await doc.save()) });
        const result = await parser.getText();
        await parser.destroy();

        expect(result.pages).toHaveLength(2);
        for (const page of result.pages) {
            expect(page.text).toContain('DRAFT');
            expect(page.text).toContain('not yet approved');
        }
    });
});

describe('request-changes note', () => {
    it('requires the reviewer to say what needs to change', () => {
        expect(requestChangesSchema.safeParse({ note: '  ' }).success).toBe(false);
        expect(requestChangesSchema.safeParse({ note: 'Add the 2025 annual resolution.' }).success).toBe(true);
    });
});
