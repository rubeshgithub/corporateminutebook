import { describe, it, expect } from 'vitest';
import { WITHHELD, viewerCompany, viewerEvents, redactPerson, redactEventData, redactedForViewer } from '../src/utils/shareRedaction';

/** Distinctive markers — the test fails if any of them leak. */
const PII = {
    email:   'jane.director@private-marker.example',
    phone:   '403-555-0199-MARKER',
    address: '742 Evergreen Terrace MARKER',
};

const company = {
    _id: 'c1',
    name: 'Acme Widgets Inc.',
    corporateAccessNumber: '2012345678',
    businessNumber: '123456789RC0001',
    incorporationDate: '2020-01-01',
    registrySignature: { provinceKey: 'ab', registryId: 'AB-1' },
    registeredOfficeAddress: { street: '1 Main St', city: 'Calgary', province: 'AB', postalCode: 'T2P 0A1', country: 'Canada' },
    addressForService: { sameAsRegistered: false, street: '2 Service Rd', email: 'service@acme.example' },
    authorizedBy: { name: 'Jane Director', email: PII.email, phone: PII.phone },
    shareClasses: [{ name: 'Class A', type: 'Common', voting: true, maxAuthorized: null, parValue: null }],
    directors: [{
        name: 'Jane Director', firstName: 'Jane', lastName: 'Director',
        address: PII.address, city: 'Calgary', province: 'AB', postalCode: 'T2P 0A1', country: 'Canada',
        email: PII.email, phone: PII.phone, appointedDate: '2020-01-01',
    }],
    officers: [{ name: 'Bob Officer', title: 'President', email: PII.email, phone: PII.phone, appointedDate: '2020-01-01' }],
    shareholders: [{
        name: 'Jane Director', sharesClass: 'Class A', numberOfShares: 100, certificateNumber: 1,
        address: PII.address, city: 'Calgary', email: PII.email, phone: PII.phone,
    }],
    incorporationDocumentFile: 'abc-123.pdf',
    crsCustomerEmail: PII.email,
    notifications: { fyeRemindedForYear: 2025 },
    drift: { detectedAt: '2026-01-01', fields: ['name'] },
    origin: 'crs_seeded',
    claimedAt: null,
    userId: 'u1',
};

const events = [{
    _id: 'e1', companyId: 'c1', userId: 'u1', eventType: 'director_appointed', effectiveDate: '2020-01-01',
    notes: 'Founding',
    data: {
        firstName: 'Jane', lastName: 'Director',
        address: PII.address, email: PII.email, phone: PII.phone,
        nested: { homeAddress: PII.address, list: [{ contactEmail: PII.email }] },
        count: 3, flag: false, empty: '',
    },
    attachments: [{ role: 'resolution', fileId: 'file-1', originalName: 'signed.pdf', uploadedAt: '2020-01-02' }],
    eSign: { status: 'none' },
}];

const leaks = (value: unknown) => {
    const s = JSON.stringify(value);
    return Object.values(PII).filter((marker) => s.includes(marker));
};

describe('viewerCompany (shared-view JSON)', () => {
    const out = viewerCompany(company);

    it('carries no personal contact info', () => {
        expect(leaks(out)).toEqual([]);
    });

    it('keeps the registry-public facts', () => {
        expect(out.name).toBe('Acme Widgets Inc.');
        expect(out.jurisdiction).toBe('ab');
        expect(out.registeredOfficeAddress).toEqual(company.registeredOfficeAddress);
        expect(out.directors[0]).toEqual({ name: 'Jane Director', firstName: 'Jane', middleName: undefined, lastName: 'Director', appointedDate: '2020-01-01', resignedDate: undefined });
        expect(out.shareholders[0]).toEqual({ name: 'Jane Director', sharesClass: 'Class A', numberOfShares: 100, certificateNumber: 1 });
    });

    it('drops the owner-side bookkeeping entirely', () => {
        const keys = Object.keys(out);
        for (const k of ['incorporationDocumentFile', 'crsCustomerEmail', 'notifications', 'drift', 'origin', 'claimedAt', 'userId', '_id', 'authorizedBy', 'addressForService']) {
            expect(keys).not.toContain(k);
        }
    });

    it('tolerates a company with no arrays or addresses', () => {
        const bare = viewerCompany({ name: 'Bare Inc.' });
        expect(bare.directors).toEqual([]);
        expect(bare.registeredOfficeAddress).toBeUndefined();
    });
});

describe('viewerEvents (shared-view JSON)', () => {
    it('keeps only the label, date, notes and attachment roles', () => {
        const out = viewerEvents(events);
        expect(out).toEqual([{
            _id: 'e1', eventType: 'director_appointed', effectiveDate: '2020-01-01', notes: 'Founding',
            attachments: [{ role: 'resolution' }],
        }]);
        expect(leaks(out)).toEqual([]);
    });
});

describe('redactPerson', () => {
    it('masks contact fields with a visible placeholder and blanks the address parts', () => {
        const p = redactPerson(company.directors[0]);
        expect(p.address).toBe(WITHHELD);
        expect(p.email).toBe(WITHHELD);
        expect(p.phone).toBe(WITHHELD);
        expect(p.city).toBeUndefined();
        expect(p.postalCode).toBeUndefined();
        expect(p.name).toBe('Jane Director');
    });

    it('leaves absent fields absent rather than inventing placeholders', () => {
        const p = redactPerson({ name: 'Nobody' } as any);
        expect(p.address).toBeUndefined();
        expect(p.email).toBeUndefined();
    });

    it('passes non-objects through', () => {
        expect(redactPerson(null as any)).toBeNull();
    });
});

describe('redactEventData', () => {
    it('masks any key that smells like contact info, recursively, and keeps the rest', () => {
        const out = redactEventData(events[0].data);
        expect(out.address).toBe(WITHHELD);
        expect(out.email).toBe(WITHHELD);
        expect(out.phone).toBe(WITHHELD);
        expect(out.nested.homeAddress).toBe(WITHHELD);
        expect(out.nested.list[0].contactEmail).toBe(WITHHELD);
        expect(out.firstName).toBe('Jane');
        expect(out.count).toBe(3);
        expect(out.flag).toBe(false);
        expect(out.empty).toBe('');
        expect(leaks(out)).toEqual([]);
    });

    it('handles primitives and arrays at the top level', () => {
        expect(redactEventData('x')).toBe('x');
        expect(redactEventData([{ email: 'a@b.c' }, 1])).toEqual([{ email: WITHHELD }, 1]);
    });
});

describe('redactedForViewer (PDF projection)', () => {
    const { company: c, events: e } = redactedForViewer(company, events);

    it('leaks no personal contact info anywhere in the PDF inputs', () => {
        expect(leaks({ c, e })).toEqual([]);
    });

    it('keeps the corporate addresses and the owner-uploaded attachments', () => {
        expect(c.registeredOfficeAddress).toEqual(company.registeredOfficeAddress);
        expect(c.addressForService.street).toBe('2 Service Rd');
        expect(c.addressForService.email).toBeUndefined();
        expect(e[0].attachments).toEqual(events[0].attachments);
    });

    it('drops the incorporation-document upload and the CRS order email', () => {
        expect(c.incorporationDocumentFile).toBeUndefined();
        expect(c.crsCustomerEmail).toBeUndefined();
    });

    it('does not mutate its inputs', () => {
        expect(company.directors[0].email).toBe(PII.email);
        expect(events[0].data.email).toBe(PII.email);
    });

    it('copes with a company missing every optional block', () => {
        const r = redactedForViewer({ name: 'Bare Inc.' }, [{ _id: 'e' }]);
        expect(r.company.directors).toEqual([]);
        expect(r.company.authorizedBy).toBeUndefined();
        expect(r.events[0].data).toEqual({});
    });
});
