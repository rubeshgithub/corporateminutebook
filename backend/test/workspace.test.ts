import { describe, it, expect } from 'vitest';
import {
    companyScope, canDeleteCompany, canMoveToFirm, wouldRemoveLastSupervisor, isFirmCompany,
    type Workspace,
} from '../src/utils/workspace';
import { createInviteSchema, createOrganizationSchema, updateMemberRoleSchema } from '../src/schemas/organization.schema';
import { createCompanySchema, updateCompanySchema } from '../src/schemas/company.schema';

const ALICE = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const FIRM = 'ffffffffffffffffffffffff';
const OTHER_FIRM = 'eeeeeeeeeeeeeeeeeeeeeeee';

const solo: Workspace = { userId: ALICE, organizationId: null, organizationRole: null };
const supervisor: Workspace = { userId: ALICE, organizationId: FIRM, organizationRole: 'supervisor' };
const assistant: Workspace = { userId: BOB, organizationId: FIRM, organizationRole: 'member' };

describe('companyScope', () => {
    it('limits a solo user to their own personal companies', () => {
        expect(companyScope(solo)).toEqual({ userId: ALICE, organizationId: null });
    });

    it('gives a firm member their personal companies plus every firm company', () => {
        expect(companyScope(assistant)).toEqual({
            $or: [
                { userId: BOB, organizationId: null },
                { organizationId: FIRM },
            ],
        });
    });

    it('never matches a colleague\'s personal companies', () => {
        // The personal branch is pinned to the caller's own userId.
        const scope = companyScope(assistant) as { $or: Array<Record<string, unknown>> };
        const personal = scope.$or.find((f) => 'userId' in f)!;
        expect(personal.userId).toBe(BOB);
        expect(personal.organizationId).toBeNull();
    });

    it('fails closed without a userId instead of widening to every tenant', () => {
        expect(() => companyScope({ userId: '', organizationId: null, organizationRole: null })).toThrow();
    });
});

describe('canDeleteCompany', () => {
    const personalOfAlice = { userId: ALICE, organizationId: null };
    const firmCompany = { userId: BOB, organizationId: FIRM };

    it('lets the creator delete a personal company', () => {
        expect(canDeleteCompany(solo, personalOfAlice)).toBe(true);
    });

    it('lets a supervisor delete a firm company', () => {
        expect(canDeleteCompany(supervisor, firmCompany)).toBe(true);
    });

    it('stops a legal assistant deleting a firm company, even one they created', () => {
        expect(canDeleteCompany(assistant, firmCompany)).toBe(false);
    });

    it('stops a supervisor deleting another firm\'s company', () => {
        expect(canDeleteCompany(supervisor, { userId: BOB, organizationId: OTHER_FIRM })).toBe(false);
    });

    it('treats ObjectId-like values by their string form', () => {
        const oid = { toString: () => FIRM };
        expect(canDeleteCompany(supervisor, { userId: BOB, organizationId: oid })).toBe(true);
    });
});

describe('canMoveToFirm', () => {
    it('lets a firm member move their own personal company in', () => {
        expect(canMoveToFirm(assistant, { userId: BOB, organizationId: null })).toBe(true);
    });

    it('refuses someone who is not in a firm', () => {
        expect(canMoveToFirm(solo, { userId: ALICE, organizationId: null })).toBe(false);
    });

    it('refuses a company that is already a firm company', () => {
        expect(canMoveToFirm(assistant, { userId: BOB, organizationId: FIRM })).toBe(false);
    });

    it('refuses moving a company someone else created', () => {
        expect(canMoveToFirm(assistant, { userId: ALICE, organizationId: null })).toBe(false);
    });
});

describe('wouldRemoveLastSupervisor', () => {
    it('blocks removing or demoting the only supervisor', () => {
        expect(wouldRemoveLastSupervisor('supervisor', 1)).toBe(true);
    });

    it('allows it when another supervisor remains', () => {
        expect(wouldRemoveLastSupervisor('supervisor', 2)).toBe(false);
    });

    it('never blocks removing a member', () => {
        expect(wouldRemoveLastSupervisor('member', 1)).toBe(false);
    });
});

describe('isFirmCompany', () => {
    it('treats a missing organizationId (pre-firm records) as personal', () => {
        expect(isFirmCompany({ userId: ALICE })).toBe(false);
    });
});

describe('organization schemas', () => {
    it('normalizes invite emails and defaults the role to member', () => {
        const parsed = createInviteSchema.parse({ email: '  Jane@Firm.CA ' });
        expect(parsed).toEqual({ email: 'jane@firm.ca', role: 'member' });
    });

    it('rejects an unknown firm role', () => {
        expect(updateMemberRoleSchema.safeParse({ role: 'owner' }).success).toBe(false);
    });

    it('requires a firm name', () => {
        expect(createOrganizationSchema.safeParse({ name: '   ' }).success).toBe(false);
    });
});

describe('company workspace field', () => {
    const minimal = { name: 'Acme Ltd.', registeredOfficeAddress: {}, recordsAddress: {}, addressForService: {} };

    it('accepts personal or firm on create', () => {
        expect(createCompanySchema.safeParse({ ...minimal, workspace: 'firm' }).success).toBe(true);
        expect(createCompanySchema.safeParse({ ...minimal, workspace: 'personal' }).success).toBe(true);
    });

    it('rejects any other workspace value', () => {
        expect(createCompanySchema.safeParse({ ...minimal, workspace: 'someone-elses-firm' }).success).toBe(false);
    });

    it('strips a client-supplied organizationId on create and update', () => {
        const created = createCompanySchema.parse({ ...minimal, organizationId: OTHER_FIRM }) as Record<string, unknown>;
        const updated = updateCompanySchema.parse({ organizationId: OTHER_FIRM }) as Record<string, unknown>;
        expect(created.organizationId).toBeUndefined();
        expect(updated.organizationId).toBeUndefined();
    });
});
