import { Response } from 'express';
import axios from 'axios';
import { AuthRequest } from '../middleware/authMiddleware';

// Some Canadian gov endpoints reject requests without a browser-like UA.
const UPSTREAM_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; MinuteBook/1.0; +https://minutebook.corporateregistryservices.ca)',
    'Accept':     'application/json',
};

/* ─── Canada Business Registries (CBR) — federal + AB, ON, MB, SK, NS, NB, NL, PE, NT, YT, NU ─── */

interface CBRDoc {
    Company_Name:         string;
    MRAS_ID?:             string;
    BN?:                  string;
    Status_State?:        string;
    Status_Notes?:        string;
    Entity_Type?:         string;
    MRAS_Entity_Type?:    string;
    Date_Incorporated?:   string;
    Jurisdiction?:        string;
    Registry_Source?:     string;
    Reg_office_city?:     string;
    Reg_office_province?: string;
    City?:                string;
}
interface CBRResp { totalResults?: number; count?: number; docs?: CBRDoc[] }

const PROVINCE_CBR: Record<string, string> = {
    ab: 'AB', on: 'ON', mb: 'MB', sk: 'SK', ns: 'NS',
    nb: 'NB', nl: 'NL', pe: 'PE', nt: 'NT', yt: 'YT',
    nu: 'NU', federal: 'CA',
};

const CBR_LABEL: Record<string, string> = {
    AB: 'Alberta', ON: 'Ontario', MB: 'Manitoba', SK: 'Saskatchewan',
    NS: 'Nova Scotia', NB: 'New Brunswick', NL: 'Newfoundland & Labrador',
    PE: 'Prince Edward Island', NT: 'Northwest Territories',
    YT: 'Yukon', NU: 'Nunavut', BC: 'British Columbia',
    CA: 'Federal', QC: 'Quebec',
};

/* ─── BC OrgBook — BC only ─── */

interface OrgBookAttr { type: string; value: string }
interface OrgBookCred {
    names:      Array<{ text: string }>;
    topic:      { source_id: string };
    attributes: OrgBookAttr[];
}
interface OrgBookResp { total: number; results: OrgBookCred[] }

const BC_ENTITY_LABELS: Record<string, string> = {
    BC: 'BC Company', SP: 'Sole Proprietor', GP: 'General Partnership',
    LP: 'Limited Partnership', LL: 'Limited Liability Partnership',
    A:  'Extraprovincial Company', S: 'Society', BEN: 'Benefit Company',
    CP: 'Cooperative Association', ULC: 'Unlimited Liability Company',
    LLC: 'Limited Liability Company', XS: 'Extraprovincial Society',
    XP: 'Extraprovincial Partnership', PA: 'Private Act Company',
    C: 'Continuation In',
};

const oAttr = (attrs: OrgBookAttr[], type: string) =>
    attrs.find((a) => a.type === type)?.value ?? '';

/* ─── Search endpoints ─── */

export interface RegistryHit {
    name:             string;
    businessNumber:   string;
    registryId:       string;         // MRAS_ID for CBR, BC incorporation # for BC
    location:         string;
    status:           'Active' | 'Inactive';
    statusNotes:      string;
    entityType:       string;
    registrationDate: string;         // YYYY-MM-DD
    jurisdiction:     string;
    provinceKey:      string;
    source:           'cbr' | 'orgbook';
}

async function searchCBR(q: string, provinceCode?: string): Promise<{ total: number; results: RegistryHit[] }> {
    let url =
        'https://ised-isde.canada.ca/cbr/srch/api/v1/search' +
        `?fq=keyword:%7B${encodeURIComponent(q)}%7D` +
        '&lang=en&queryaction=fieldquery&sortfield=score&sortorder=desc&rows=12&start=0';
    if (provinceCode) url += `&fq=Registry_Source:${provinceCode}`;

    const { data } = await axios.get<CBRResp>(url, { timeout: 15000, headers: UPSTREAM_HEADERS });

    return {
        total: data.totalResults ?? data.count ?? 0,
        results: (data.docs ?? []).map((d) => {
            const src      = d.Registry_Source ?? '';
            const city     = d.Reg_office_city ?? d.City ?? '';
            const prov     = d.Reg_office_province ?? '';
            const location = [city, prov].filter(Boolean).join(', ');
            return {
                name:             d.Company_Name ?? 'Unknown',
                businessNumber:   d.BN ?? '',
                registryId:       (d.MRAS_ID ?? '').replace(/^[A-Z]+_/, ''),
                location,
                status:           d.Status_State === 'Active' ? 'Active' : 'Inactive',
                statusNotes:      d.Status_Notes ?? '',
                entityType:       d.Entity_Type ?? d.MRAS_Entity_Type ?? '',
                registrationDate: (d.Date_Incorporated ?? '').slice(0, 10),
                jurisdiction:     d.Jurisdiction ?? CBR_LABEL[src] ?? src,
                provinceKey:      src === 'CA' ? 'federal' : src.toLowerCase(),
                source:           'cbr' as const,
            };
        }),
    };
}

async function searchBC(q: string): Promise<{ total: number; results: RegistryHit[] }> {
    const url = `https://orgbook.gov.bc.ca/api/v4/search/credential?q=${encodeURIComponent(q)}&page=1&limit=12&format=json`;
    const { data } = await axios.get<OrgBookResp>(url, { timeout: 15000, headers: UPSTREAM_HEADERS });

    return {
        total: data.total,
        results: data.results.map((r) => {
            const typeCode = oAttr(r.attributes, 'entity_type');
            const status   = oAttr(r.attributes, 'entity_status');
            return {
                name:             r.names[0]?.text ?? 'Unknown',
                businessNumber:   '',
                registryId:       r.topic?.source_id ?? '',
                location:         'British Columbia',
                status:           status === 'ACT' ? 'Active' : 'Inactive',
                statusNotes:      status === 'ACT' ? 'Active' : status,
                entityType:       BC_ENTITY_LABELS[typeCode] ?? typeCode,
                registrationDate: oAttr(r.attributes, 'registration_date').slice(0, 10),
                jurisdiction:     'British Columbia',
                provinceKey:      'bc',
                source:           'orgbook' as const,
            };
        }),
    };
}

/**
 * GET /api/registry/search?q=...&province=all|federal|ab|bc|on|...
 * Free-text search — accepts a company name, Corporate Access Number, or Business Number.
 * Jurisdiction filter is optional.
 */
export const searchRegistry = async (req: AuthRequest, res: Response) => {
    const q        = (req.query.q as string | undefined)?.trim() ?? '';
    const province = ((req.query.province as string | undefined) ?? 'all').toLowerCase();

    if (q.length < 2) return res.json({ total: 0, results: [] });

    try {
        if (province === 'bc') {
            const bc = await searchBC(q);
            return res.json(bc);
        }
        const cbrCode = province === 'all' ? undefined : PROVINCE_CBR[province];
        const cbr = await searchCBR(q, cbrCode);
        return res.json(cbr);
    } catch (err: any) {
        console.error('[registry] search error:', err?.response?.data ?? err?.message ?? err);
        return res.status(502).json({ error: 'Registry search is temporarily unavailable.' });
    }
};

/**
 * GET /api/registry/fetch?accessNumber=...&jurisdiction=federal|ab|bc|on|...
 * Look up one company by its Corporate Access Number / registry ID / BN.
 * Returns a single record shaped for form auto-fill. Kept for backward-compat with the
 * existing Lookup button; internally it just wraps `search` and returns the first hit.
 */
export const fetchRegistryData = async (req: AuthRequest, res: Response) => {
    const accessNumber = (req.query.accessNumber as string | undefined)?.trim();
    const province     = ((req.query.jurisdiction as string | undefined) ?? 'all').toLowerCase();

    if (!accessNumber) return res.status(400).json({ error: 'Access number is required' });

    try {
        const { results } =
            province === 'bc'
                ? await searchBC(accessNumber)
                : await searchCBR(accessNumber, province === 'all' ? undefined : PROVINCE_CBR[province]);

        const hit = results[0];
        if (!hit) return res.status(404).json({ error: 'No registry record found for that identifier.' });

        const [city = '', prov = ''] = hit.location.split(',').map((s) => s.trim());
        return res.json({
            name:                  hit.name,
            corporateAccessNumber: hit.registryId,
            businessNumber:        hit.businessNumber,
            incorporationDate:     hit.registrationDate,
            registeredOfficeAddress: {
                street:     '',
                city,
                province:   prov,
                postalCode: '',
                country:    'Canada',
            },
            status:       hit.status,
            jurisdiction: hit.jurisdiction,
        });
    } catch (err: any) {
        console.error('[registry] fetch error:', err?.response?.data ?? err?.message ?? err);
        return res.status(502).json({ error: 'Registry lookup is temporarily unavailable.' });
    }
};
