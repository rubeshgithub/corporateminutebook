/**
 * Viewer-facing projections for share links.
 *
 * A share token is the only credential on the public share endpoints, so
 * every byte that leaves them has to be safe to hand to an unknown holder
 * of the link: no personal contact info (home addresses, emails, phones)
 * and none of the owner's internal bookkeeping. Two shapes are produced:
 *
 *   - viewerCompany / viewerEvents — explicit allow-lists for the JSON the
 *     shared-view SPA page renders. A new Company or event field stays
 *     private here unless deliberately added.
 *   - redactedForViewer — a masked copy of the full documents for the PDF
 *     pipeline, which needs the whole shape (templates read every field)
 *     but must print placeholders where contact info would go.
 *
 * Pure functions, no I/O — covered by backend/test/shareRedaction.test.ts.
 */

export const WITHHELD = '[withheld from shared view]';

/** Allow-listed projection of a Company doc for the shared-view JSON. */
export function viewerCompany(c: any) {
    return {
        name:                  c.name,
        corporateAccessNumber: c.corporateAccessNumber,
        businessNumber:        c.businessNumber,
        jurisdiction:          c.registrySignature?.provinceKey,
        incorporationDate:     c.incorporationDate,
        registeredOfficeAddress: c.registeredOfficeAddress && {
            street:     c.registeredOfficeAddress.street,
            city:       c.registeredOfficeAddress.city,
            province:   c.registeredOfficeAddress.province,
            postalCode: c.registeredOfficeAddress.postalCode,
            country:    c.registeredOfficeAddress.country,
        },
        shareClasses: (c.shareClasses ?? []).map((sc: any) => ({
            name:          sc.name,
            type:          sc.type,
            voting:        sc.voting,
            maxAuthorized: sc.maxAuthorized,
            parValue:      sc.parValue,
        })),
        directors: (c.directors ?? []).map((d: any) => ({
            name:          d.name,
            firstName:     d.firstName,
            middleName:    d.middleName,
            lastName:      d.lastName,
            appointedDate: d.appointedDate,
            resignedDate:  d.resignedDate,
        })),
        officers: (c.officers ?? []).map((o: any) => ({
            name:          o.name,
            title:         o.title,
            appointedDate: o.appointedDate,
            resignedDate:  o.resignedDate,
        })),
        shareholders: (c.shareholders ?? []).map((s: any) => ({
            name:              s.name,
            sharesClass:       s.sharesClass,
            numberOfShares:    s.numberOfShares,
            certificateNumber: s.certificateNumber,
        })),
    };
}

/**
 * Events get the same allow-list treatment: the raw `data` blob can carry
 * director home addresses, emails, and phones (e.g. the auto-generated
 * founding events), and the viewer page renders none of it — only the
 * label, date, notes, and attachment badges.
 */
export function viewerEvents(events: any[]) {
    return events.map((ev: any) => ({
        _id:           ev._id,
        eventType:     ev.eventType,
        effectiveDate: ev.effectiveDate,
        notes:         ev.notes,
        attachments:   (ev.attachments ?? []).map((a: any) => ({ role: a.role })),
    }));
}

/** Strip personal contact info from a person record (director / officer /
 *  shareholder / authorizedBy) before it reaches the PDF templates. Address
 *  becomes a visible placeholder — the templates join address parts with
 *  filter(Boolean), so a placeholder reads better than a silent blank in
 *  running text ("I, Jane Smith, of [withheld from shared view], …"). */
export function redactPerson<T extends Record<string, any>>(p: T): T {
    if (!p || typeof p !== 'object') return p;
    return {
        ...p,
        address:    p.address ? WITHHELD : p.address,
        city:       undefined,
        province:   undefined,
        postalCode: undefined,
        country:    undefined,
        email:      p.email ? WITHHELD : p.email,
        phone:      p.phone ? WITHHELD : p.phone,
    };
}

/** Event `data` blobs can carry addresses/emails/phones (founding events,
 *  director_address_changed). Replace any key that smells like contact info
 *  with the placeholder, recursively. */
export function redactEventData(value: any): any {
    if (Array.isArray(value)) return value.map(redactEventData);
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = /address|email|phone/i.test(k) && v ? WITHHELD : redactEventData(v);
    }
    return out;
}

/**
 * The PDF must honor the same promise as the viewerCompany() JSON
 * projection above: a share token is the only credential, so the output
 * carries no personal contact info (home addresses, emails, phones) and no
 * incorporation-document upload (which can carry incorporators' home
 * addresses). Corporate addresses (registered office, records, service)
 * stay — they are registry-public. Event attachments the owner explicitly
 * uploaded (signed resolutions, registry filings) stay: they ARE the
 * minute book being shared.
 */
export function redactedForViewer(company: any, events: any[]): { company: any; events: any[] } {
    return {
        company: {
            ...company,
            directors:    (company.directors ?? []).map(redactPerson),
            officers:     (company.officers ?? []).map(redactPerson),
            shareholders: (company.shareholders ?? []).map(redactPerson),
            authorizedBy: company.authorizedBy ? redactPerson(company.authorizedBy) : company.authorizedBy,
            addressForService: company.addressForService
                ? { ...company.addressForService, email: undefined }
                : company.addressForService,
            incorporationDocumentFile: undefined,
            // The CRS order email is the owner's personal address — no
            // template prints it, but nothing downstream should hold it.
            crsCustomerEmail: undefined,
        },
        events: events.map((ev: any) => ({ ...ev, data: redactEventData(ev.data ?? {}) })),
    };
}
