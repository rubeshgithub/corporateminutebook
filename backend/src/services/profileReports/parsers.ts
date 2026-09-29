import {
    emptyCorporation, type FilingKind, type ParsedProfileReport, type Registry,
    type ReportAddress, type ReportDirector, type ReportFiling, type ReportOfficer, type ReportShareholder,
} from './types';

/*
 * Exact readers for each registry's profile / search report, working on the
 * text layer of the PDF. Registry reports are machine-generated and stable,
 * so reading them field by field is more trustworthy than a model's summary:
 * a misread date here becomes a wrong entry in a legal record.
 */

// ─── Dates ──────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (y: number, m: number | undefined, d: number): string | null =>
    y > 1800 && m && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;

/** "September 13, 2018" · "2026/08/21" · "2026-09-15" · "13-Dec-2019" → YYYY-MM-DD */
export const parseRegistryDate = (raw?: string | null): string | null => {
    if (!raw) return null;
    const s = raw.trim();
    let m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return toIso(+m[1], +m[2], +m[3]);
    m = s.match(/(\d{1,2})-([A-Za-z]{3})[A-Za-z]*-(\d{4})/);
    if (m) return toIso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    m = s.match(/([A-Za-z]{3,})\.? (\d{1,2}), (\d{4})/);
    if (m) return toIso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
    return null;
};

const LONG_DATE = '[A-Za-z]+ \\d{1,2}, \\d{4}';
const DMY_DATE = '\\d{1,2}-[A-Za-z]{3}-\\d{4}';

// ─── Text helpers ───────────────────────────────────────────────────────────

const PAGE_MARKER = /^--\s*\d+ of \d+\s*--$/;

const toLines = (text: string, dropPatterns: RegExp[] = []): string[] =>
    text
        .split(/\r?\n/)
        .map((l) => l.replace(/\s+$/, ''))
        .filter((l) => l.trim() !== '' && !PAGE_MARKER.test(l.trim()) && !dropPatterns.some((p) => p.test(l.trim())));

const grab = (text: string, re: RegExp): string => (text.match(re)?.[1] ?? '').trim();

const indexOfLine = (lines: string[], re: RegExp, from = 0): number => {
    for (let i = from; i < lines.length; i++) if (re.test(lines[i].trim())) return i;
    return -1;
};

/** Lines strictly between the first line matching `start` and the next line matching any of `ends`. */
const section = (lines: string[], start: RegExp, ends: RegExp[]): string[] => {
    const s = indexOfLine(lines, start);
    if (s < 0) return [];
    let e = lines.length;
    for (let i = s + 1; i < lines.length; i++) {
        if (ends.some((re) => re.test(lines[i].trim()))) { e = i; break; }
    }
    return lines.slice(s + 1, e).map((l) => l.trim());
};

const PROVINCES: Record<string, string> = {
    alberta: 'AB', 'british columbia': 'BC', ontario: 'ON', saskatchewan: 'SK', manitoba: 'MB', quebec: 'QC',
    québec: 'QC', 'new brunswick': 'NB', 'nova scotia': 'NS', 'prince edward island': 'PE',
    'newfoundland and labrador': 'NL', yukon: 'YT', 'northwest territories': 'NT', nunavut: 'NU',
};
const PROVINCE_CODES = new Set(Object.values(PROVINCES));
const provinceCode = (s: string): string => {
    const t = s.trim();
    if (PROVINCE_CODES.has(t.toUpperCase())) return t.toUpperCase();
    return PROVINCES[t.toLowerCase()] ?? t;
};

const POSTAL = /[A-Z]\d[A-Z] ?\d[A-Z]\d/i;
const normalizePostal = (s: string) => {
    const p = s.toUpperCase().replace(/\s+/g, '');
    return p.length === 6 ? `${p.slice(0, 3)} ${p.slice(3)}` : s.toUpperCase();
};

export const formatAddress = (a: ReportAddress | null): string =>
    a ? [a.street, [a.city, a.province, a.postalCode].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ') : '';

/** "VICTORIA BC V8P 2K4" → city/province/postal. Foreign lines are kept whole as the city. */
const parseCityLine = (line: string): Pick<ReportAddress, 'city' | 'province' | 'postalCode'> => {
    const m = line.trim().match(/^(.*?)[ ,]+([A-Za-z]{2})\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)$/i);
    if (m && PROVINCE_CODES.has(m[2].toUpperCase())) {
        return { city: m[1].trim(), province: m[2].toUpperCase(), postalCode: normalizePostal(m[3]) };
    }
    return { city: line.trim(), province: '', postalCode: '' };
};

/** Stacked lines: street…, "CITY PR A1A 1A1", COUNTRY. */
const addressFromLines = (lines: string[]): ReportAddress | null => {
    const ls = lines.map((l) => l.trim()).filter(Boolean);
    if (ls.length === 0) return null;
    let country = 'Canada';
    if (ls.length >= 2 && /^[A-Za-z .'-]+$/.test(ls[ls.length - 1]) && !POSTAL.test(ls[ls.length - 1])) {
        country = ls.pop()!;
    }
    const cityLine = ls.length >= 2 ? ls.pop()! : '';
    return { street: ls.join(', '), ...parseCityLine(cityLine), country: titleCountry(country) };
};

/**
 * "201 Georgian Drive, Barrie, Ontario, L4M 6M3, Canada" (Ontario) or
 * "525 8TH AVENUE SW, CALGARY, Alberta, Canada, T2P 1G1" (Saskatchewan) —
 * the postal code may come before or after the country.
 */
const addressFromCommas = (raw: string): ReportAddress | null => {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    let country = 'Canada';
    let postalCode = '';
    let province = '';
    const postalIdx = parts.findIndex((p, i) => i > 0 && /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i.test(p));
    if (postalIdx > 0) postalCode = normalizePostal(parts.splice(postalIdx, 1)[0]);
    if (parts.length > 1 && /^[A-Za-z .'-]+$/.test(parts[parts.length - 1]) && !PROVINCES[parts[parts.length - 1].toLowerCase()]) {
        country = parts.pop()!;
    }
    if (parts.length > 1 && (PROVINCES[parts[parts.length - 1].toLowerCase()] || PROVINCE_CODES.has(parts[parts.length - 1].toUpperCase()))) {
        province = provinceCode(parts.pop()!);
    }
    const city = parts.length > 1 ? parts.pop()! : '';
    return { street: parts.join(', '), city, province, postalCode, country: titleCountry(country) };
};

const titleCountry = (c: string) => (/^canada$/i.test(c.trim()) ? 'Canada' : c.trim());

/** "Foukal, Deanna Marie" (registry order) → parts. */
const nameFromLastFirst = (raw: string) => {
    const [last, rest = ''] = raw.split(',').map((s) => s.trim());
    const given = rest.split(/\s+/).filter(Boolean);
    const firstName = given[0] ?? '';
    const middleName = given.slice(1).join(' ');
    return { firstName, middleName, lastName: last, name: [firstName, middleName, last].filter(Boolean).join(' ') };
};

/** "JANE ANN DOE" (natural order) → parts. */
const nameFromNatural = (raw: string) => {
    const w = raw.trim().split(/\s+/);
    const lastName = w.length > 1 ? w[w.length - 1] : '';
    const firstName = w[0] ?? '';
    const middleName = w.length > 2 ? w.slice(1, -1).join(' ') : '';
    return { firstName, middleName, lastName, name: raw.trim() };
};

export const filingKind = (label: string): FilingKind => {
    const l = label.toLowerCase();
    if (/annual return/.test(l)) return 'annual_return';
    if (/initial return/.test(l)) return 'initial_return';
    if (/register extra-provincial|extra-provincial registration|nwp amalgamation|registration/.test(l)) return 'registration';
    if (/incorporat|articles of incorporation|certificate of amalgamation|amalgamat/.test(l)) return 'incorporation';
    if (/reviv|restor/.test(l)) return 'revival';
    if (/struck|strike|dissol|cancel/.test(l)) return 'status';
    if (/amend|name change|articles of amendment|restated/.test(l)) return 'amendment';
    if (/notice of change|change of|change director|change address|change agent|director|address/.test(l)) return 'change';
    return 'other';
};

const blankReport = (registry: Registry, registryName: string): ParsedProfileReport => ({
    registry, source: 'parser', registryName, reportDate: null, corporation: emptyCorporation(),
    registeredOffice: null, recordsOffice: null, directors: [], officers: [], shareholders: [],
    annualReturns: [], annualReturnsOutstanding: [], annualReturnAnniversary: null, noAnnualReturnOnFile: false,
    filings: [], nameHistory: [], significantIndividuals: [],
});

const toInt = (s: string): number | null => (/^\d+$/.test(s.trim()) ? parseInt(s.trim(), 10) : null);

// ─── Detection ──────────────────────────────────────────────────────────────

export const detectRegistry = (text: string): Registry | null => {
    if (/Corporate Profile\s*\/\s*Profil corporatif/i.test(text) || (/Corporations Canada/i.test(text) && /Corporation number/i.test(text))) return 'federal';
    if (/BC Company Summary/i.test(text) || (/corporateonline\.gov\.bc\.ca/i.test(text) && /Incorporation Number:/i.test(text))) return 'bc';
    if (/Ontario Corporation Number \(OCN\)/i.test(text)) return 'on';
    if (/Corporate Registration System/i.test(text) && /Corporate Access Number:/i.test(text)) return 'ab';
    if ((/Saskatchewan[\s\S]{0,60}Corporate Registry|Information Services Corporation|isc\.ca/i.test(text)) && /Entity Number/i.test(text)) return 'sk';
    return null;
};

// ─── British Columbia — "BC Company Summary" (BC Registries) ────────────────

const BC_DROP = [/^BC\d+ Page: \d+ of \d+/, /^[A-Z]{1,2}\d+ Page: \d+ of \d+/];
const BC_ADDRESS_LABEL = /^(Mailing|Delivery) Address:$/;

const bcAddress = (block: string[]): ReportAddress | null => {
    // Prefer the delivery (physical) address; fall back to mailing.
    const pick = (label: RegExp) => {
        const i = block.findIndex((l) => label.test(l));
        if (i < 0) return null;
        const out: string[] = [];
        for (let j = i + 1; j < block.length && !BC_ADDRESS_LABEL.test(block[j]) && !/:$/.test(block[j]); j++) out.push(block[j]);
        return out;
    };
    const lines = pick(/^Delivery Address:$/) ?? pick(/^Mailing Address:$/);
    return lines ? addressFromLines(lines) : null;
};

export const parseBc = (text: string): ParsedProfileReport => {
    const r = blankReport('bc', 'BC Registries and Online Services');
    const lines = toLines(text, BC_DROP);

    r.reportDate = parseRegistryDate(grab(text, new RegExp(`Date and Time of Search:\\s*(${LONG_DATE})`)));
    const c = r.corporation;
    c.number = grab(text, /Incorporation Number:\s*(\S+)/);
    c.name = grab(text, /Name of Company:\s*(.+)/);
    c.businessNumber = grab(text, /Business Number:\s*([0-9][0-9 ]*[A-Z]{2}\s*\d{4})/).replace(/\s+/g, '');
    c.incorporationDate = parseRegistryDate(grab(text, new RegExp(`(?:Incorporated|Amalgamated|Continued In) on (${LONG_DATE})`)));
    c.entityType = /BC Company Summary/i.test(text) ? 'BC Company' : 'British Columbia company';
    const currencyIdx = indexOfLine(lines, /^Currency Date:/);
    if (currencyIdx >= 0 && /^[A-Z ]+$/.test(lines[currencyIdx + 1]?.trim() ?? '')) c.status = lines[currencyIdx + 1].trim();

    const lastAr = grab(text, new RegExp(`Last Annual Report Filed:\\s*(Not Available|${LONG_DATE})`));
    if (/Not Available/i.test(lastAr)) {
        r.noAnnualReturnOnFile = true;
    } else {
        const filedOn = parseRegistryDate(lastAr);
        if (filedOn) r.annualReturns.push({ year: +filedOn.slice(0, 4), filedOn });
    }

    const ends = [/^REGISTERED OFFICE INFORMATION$/, /^RECORDS OFFICE INFORMATION$/, /^DIRECTOR INFORMATION$/, /^OFFICER INFORMATION$/, /^NO OFFICER INFORMATION/];
    r.registeredOffice = bcAddress(section(lines, /^REGISTERED OFFICE INFORMATION$/, ends));
    r.recordsOffice = bcAddress(section(lines, /^RECORDS OFFICE INFORMATION$/, ends));

    const splitPeople = (block: string[]) => {
        const people: string[][] = [];
        for (const l of block) {
            if (/^Last Name, First Name, Middle Name:$/.test(l)) people.push([]);
            else if (people.length) people[people.length - 1].push(l);
        }
        return people;
    };

    for (const p of splitPeople(section(lines, /^DIRECTOR INFORMATION$/, [/^OFFICER INFORMATION$/, /^NO OFFICER INFORMATION/]))) {
        const n = nameFromLastFirst(p[0] ?? '');
        r.directors.push({ ...n, address: formatAddress(bcAddress(p.slice(1))), residentCanadian: null, appointedDate: null });
    }

    for (const p of splitPeople(section(lines, /^OFFICER INFORMATION$/, [/^$/]))) {
        const n = nameFromLastFirst(p[0] ?? '');
        const held = p.find((l) => /^Office\(s\) Held:/i.test(l)) ?? '';
        const titles = held.replace(/^Office\(s\) Held:\s*/i, '').replace(/[()]/g, '').split(',').map((t) => t.trim()).filter(Boolean);
        for (const title of titles.length ? titles : ['Officer']) r.officers.push({ name: n.name, title, appointedDate: null });
    }
    return r;
};

// ─── Ontario — "Profile Report" (Ontario Business Registry) ─────────────────

const ON_DROP = [
    /^Transaction Number:/, /^Report Generated on/, /^Certified a true copy/, /^Director\/Registrar$/,
    /^This report sets out/, /^and recorded in the electronic/, /^for a previous date/, /^Additional historical information/,
    /^Page \d+ of \d+$/, /^All “PAF”/, /^All "PAF"/, /^not shown against a document/,
];

export const parseOntario = (text: string): ParsedProfileReport => {
    const r = blankReport('on', 'Ontario Business Registry');
    const lines = toLines(text, ON_DROP);

    r.reportDate = parseRegistryDate(grab(text, new RegExp(`Report Generated on (${LONG_DATE})`)))
        ?? parseRegistryDate(grab(text, new RegExp(` as of (${LONG_DATE})`)));
    const c = r.corporation;
    c.name = grab(text, /^Name (.+)$/m);
    c.number = grab(text, /Ontario Corporation Number \(OCN\) (\d+)/);
    c.entityType = grab(text, /^Type (.+)$/m);
    c.status = grab(text, /^Status (.+)$/m);
    c.incorporationDate = parseRegistryDate(grab(text, new RegExp(`Date of (?:Incorporation|Amalgamation|Continuation) (${LONG_DATE})`)));
    c.minDirectors = toInt(grab(text, /Minimum Number of Directors (\d+)/));
    c.maxDirectors = toInt(grab(text, /Maximum Number of Directors (\d+)/));
    r.registeredOffice = addressFromCommas(grab(text, /Registered or Head Office Address (.+)$/m));

    const people = (block: string[], withPosition: boolean) => {
        const out: Array<Record<string, string>> = [];
        for (const l of block) {
            const m = l.match(/^(Name|Position|Address for Service|Resident Canadian|Date Began|Date Ended) (.+)$/);
            if (!m) continue;
            if (m[1] === 'Name') out.push({ name: m[2].trim() });
            else if (out.length) out[out.length - 1][m[1]] = m[2].trim();
        }
        return withPosition ? out.filter((o) => o.Position) : out;
    };

    const sectionEnds = [/^Active Officer\(s\)$/, /^Corporate Name History$/, /^Active Business Names$/, /^Expired or Cancelled Business Names$/, /^Document List$/, /^Inactive Director\(s\)$/];
    for (const d of people(section(lines, /^Active Director\(s\)$/, sectionEnds), false)) {
        r.directors.push({
            ...nameFromNatural(d.name),
            address: d['Address for Service'] ?? '',
            residentCanadian: d['Resident Canadian'] ? /^yes/i.test(d['Resident Canadian']) : null,
            appointedDate: parseRegistryDate(d['Date Began']),
        });
    }
    for (const o of people(section(lines, /^Active Officer\(s\)$/, sectionEnds.filter((e) => !e.test('Active Officer(s)'))), true)) {
        r.officers.push({ name: o.name, title: o.Position, appointedDate: parseRegistryDate(o['Date Began']) });
    }

    const nameBlock = section(lines, /^Corporate Name History$/, sectionEnds);
    let pendingName = '';
    for (const l of nameBlock) {
        const n = l.match(/^Name (.+)$/);
        if (n) { pendingName = n[1].trim(); continue; }
        const e = l.match(/^Effective Date (.+)$/);
        if (e && pendingName) { r.nameHistory.push({ name: pendingName, from: parseRegistryDate(e[1]) }); pendingName = ''; }
    }

    // Document list: a filing label, optionally a "PAF:" line, then its date —
    // or label and date on one line.
    const docs = section(lines, /^Document List$/, []).filter((l) => !/^Filing Name Effective Date$/.test(l));
    const dateAtEnd = new RegExp(`^(.*?)\\s*(${LONG_DATE})$`);
    let label = '';
    for (const l of docs) {
        if (/^PAF:/.test(l)) continue;
        const m = l.match(dateAtEnd);
        if (m && m[1]) {
            pushOntarioFiling(r, m[1].trim(), parseRegistryDate(m[2]));
            label = '';
        } else if (m && !m[1]) {
            if (label) pushOntarioFiling(r, label, parseRegistryDate(m[2]));
            label = '';
        } else {
            label = l.trim();
        }
    }
    return r;
};

const pushOntarioFiling = (r: ParsedProfileReport, label: string, date: string | null) => {
    if (!date) return;
    const kind = filingKind(label);
    const year = kind === 'annual_return' ? toInt(label.match(/(\d{4})\s*$/)?.[1] ?? '') ?? undefined : undefined;
    r.filings.push({ date, label, kind, ...(year ? { year } : {}) });
    if (kind === 'annual_return' && year) r.annualReturns.push({ year, filedOn: date });
};

// ─── Federal — Corporations Canada "Corporate Profile" ──────────────────────

const FED_ISC_ENGLISH = /^(Has |Holds |More than |Less than |Between |Directly$|Indirectly$|Individually$|Jointly$|Registered holder|Beneficial owner|Control in fact)/;

export const parseFederal = (text: string): ParsedProfileReport => {
    const r = blankReport('federal', 'Corporations Canada');
    const lines = toLines(text, [/^\d+ \d+\s*\/$/, /^Telephone \/ Téléphone$/, /^Email \/ Courriel$/, /^Website \/ Site Web$/, /^1-866-333-5556$/, /^ic\.corporationscanada/, /^https:\/\/corporationscanada/]);

    r.reportDate = parseRegistryDate(grab(text, /Date and time of Corporate Profile[^\n]*?(\d{4}-\d{2}-\d{2})/));
    const c = r.corporation;
    c.number = grab(text, /Corporation number[^\t\n]*\t\s*(\S+)/);
    c.businessNumber = grab(text, /Business number[^\t\n]*\t\s*(\S+)/);
    c.incorporationDate = parseRegistryDate(grab(text, /Canada Business Corporations Act \(CBCA\) - (\d{4}-\d{2}-\d{2})/))
        ?? parseRegistryDate(grab(text, /Certificate of (?:Incorporation|Amalgamation|Continuance)[^\n]*?(\d{4}-\d{2}-\d{2})/));
    c.entityType = /Canada Business Corporations Act/.test(text) ? 'Federal corporation (CBCA)' : 'Federal corporation';
    const statusIdx = indexOfLine(lines, /^Status Statut$/);
    if (statusIdx >= 0) c.status = lines[statusIdx + 1]?.trim() ?? '';
    c.minDirectors = toInt(grab(text, /Minimum number[^\t\n]*\t\s*(\d+)/));
    c.maxDirectors = toInt(grab(text, /Maximum number[^\t\n]*\t\s*(\d+)/));

    for (const l of lines) {
        const m = l.trim().match(/^(\d{4}-\d{2}-\d{2}) to (present \/ à maintenant|\d{4}-\d{2}-\d{2}) (.+)$/);
        if (m) r.nameHistory.push({ name: m[3].trim(), from: m[1] });
    }
    r.nameHistory.sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
    const current = lines.map((l) => l.trim().match(/^\d{4}-\d{2}-\d{2} to present \/ à maintenant (.+)$/)).find(Boolean);
    c.name = current ? current[1].trim() : '';

    r.registeredOffice = addressFromLines(section(lines, /^REGISTERED OFFICE ADDRESS/, [/^ANNUAL FILINGS/]));

    r.annualReturnAnniversary = grab(text, /Anniversary date[^\n]*?\t\s*(\d{2}-\d{2})/) || null;
    for (const l of lines) {
        const filed = l.trim().match(/^Filed (\d{4})\b/);
        if (filed) r.annualReturns.push({ year: +filed[1], filedOn: null });
        const late = l.trim().match(/^(Overdue|Not filed|Past due)\s+(\d{4})\b/i);
        if (late) r.annualReturnsOutstanding.push(+late[2]);
    }

    for (const l of section(lines, /^Current number/, [/^CORPORATE HISTORY/])) {
        const m = l.match(/^(.+?)\s+((?:\d|P\.?\s?O\.?\s?Box|Suite|Unit|Apt).*)$/i);
        const name = (m ? m[1] : l).trim();
        r.directors.push({ ...nameFromNatural(name), address: m ? m[2].trim() : '', residentCanadian: null, appointedDate: null });
    }

    for (const l of section(lines, /^Certificates issued/, [/^Amendments details/, /^Documents filed/])) {
        const m = l.match(/^(Certificate of .+?)\s+Certificat.*?(\d{4}-\d{2}-\d{2})\s*$/);
        if (m) r.filings.push({ date: m[2], label: m[1].trim(), kind: filingKind(m[1]) });
    }
    for (const l of section(lines, /^Documents filed/, [/^INDIVIDUALS WITH SIGNIFICANT CONTROL/])) {
        const m = l.match(/^(.+?)\s+(\d{4}-\d{2}-\d{2})\s*$/);
        if (m) r.filings.push({ date: m[2], label: m[1].trim(), kind: filingKind(m[1]) });
    }

    // Significant-control register: an upper-case name, an address, then
    // bilingual descriptors and a start date.
    const isc = section(lines, /^Current \d+ Actuel$/, [/^The Corporate Profile sets out/]);
    for (let i = 0; i < isc.length; i++) {
        if (/^[A-Z][A-Z .'-]+$/.test(isc[i]) && /\d/.test(isc[i + 1] ?? '')) {
            const entry = { name: isc[i], address: isc[i + 1], description: '', since: null as string | null };
            const desc: string[] = [];
            for (let j = i + 2; j < isc.length && !(/^[A-Z][A-Z .'-]+$/.test(isc[j]) && /\d/.test(isc[j + 1] ?? '')); j++) {
                if (!entry.since && /^\d{4}-\d{2}-\d{2}$/.test(isc[j])) entry.since = isc[j];
                if (FED_ISC_ENGLISH.test(isc[j])) desc.push(isc[j].replace(/\s*\/$/, ''));
            }
            entry.description = desc.join('; ');
            r.significantIndividuals.push(entry);
        }
    }
    return r;
};

// ─── Alberta — Corporate Registration System search ─────────────────────────

const AB_SECTIONS = [
    /^Directors:$/, /^Officers:$/, /^Voting Shareholders:$/, /^Other Information:$/, /^Details From Current Articles:?$/,
    /^Holding Shares In:$/, /^Associated Registration/, /^Last Annual Return Filed:$/, /^Filing History:$/,
    /^Attachments:$/, /^Primary Agent for Service:$/, /^Registered Office:$/, /^Records Address:$/, /^Head Office Address:$/,
    /^Mailing Address:$/, /^Outstanding Returns:$/, /^The Registrar of Corporations certifies/,
];

const abField = (block: string[], label: string): string => {
    const re = new RegExp(`^${label}:\\s*(.*)$`);
    for (const l of block) {
        const m = l.match(re);
        if (m) return m[1].trim();
    }
    return '';
};

const abAddress = (block: string[]): ReportAddress | null => {
    const street = abField(block, 'Street') || abField(block, 'Street/Box Number');
    if (!street) return null;
    const postal = abField(block, 'Postal Code');
    return {
        street,
        city: abField(block, 'City'),
        province: provinceCode(abField(block, 'Province')),
        postalCode: postal ? normalizePostal(postal) : '',
        country: 'Canada',
    };
};

const LABEL_ONLY = /^[A-Za-z][A-Za-z0-9 /'().&-]*:$/;
const LABELLED = /^[A-Za-z][A-Za-z0-9 /'().&-]*:\s*\S/;

/**
 * Alberta searches come in two layouts: "Street: 101 MAIN" on one line, or a
 * column of labels followed by a column of values. Re-pairs the column
 * layout into "Label: value" lines so both read the same way.
 */
const pairColumns = (lines: string[]): string[] => {
    const out: string[] = [];
    for (let i = 0; i < lines.length; ) {
        const labels: string[] = [];
        let j = i;
        while (j < lines.length && LABEL_ONLY.test(lines[j]) && !AB_SECTIONS.some((re) => re.test(lines[j]))) labels.push(lines[j++]);
        if (labels.length === 0) { out.push(lines[i++]); continue; }
        const values: string[] = [];
        while (j < lines.length && values.length < labels.length && !LABEL_ONLY.test(lines[j]) && !LABELLED.test(lines[j])) values.push(lines[j++]);
        if (values.length === 0) { out.push(...labels); i = j; continue; }
        labels.forEach((l, k) => out.push(values[k] !== undefined ? `${l} ${values[k]}` : l));
        i = j;
    }
    return out;
};

export const parseAlberta = (text: string): ParsedProfileReport => {
    const r = blankReport('ab', 'Alberta Corporate Registry');
    const lines = pairColumns(toLines(text).map((l) => l.replace(/\t/g, ' ').replace(/ {2,}/g, ' ').replace(/^Government |^of Alberta ■ /, '').trim()));
    const t = lines.join('\n');

    r.reportDate = parseRegistryDate(grab(t, /Date of Search:\s*(\d{4}\/\d{2}\/\d{2})/));
    const c = r.corporation;
    c.number = grab(t, /Corporate Access Number:\s*(\d+)/);
    c.businessNumber = grab(t, /Business Number:[ \t]*([^\n]*)/).replace(/\s+/g, '');
    c.name = grab(t, /Legal Entity Name:\s*(.+)/);
    c.status = grab(t, /Legal Entity Status:\s*(.+)/);
    c.entityType = grab(t, /Legal Entity Type:\s*(.+)/) || grab(t, /Extra-Provincial Type:\s*(.+)/);
    c.email = grab(t, /Email Address:\s*(\S+@\S+)/);
    const registered = parseRegistryDate(grab(t, /Registration Date:\s*(\d{4}\/\d{2}\/\d{2})/));

    const revived = parseRegistryDate(grab(t, /Revival\/Restoration Date:\s*(\d{4}\/\d{2}\/\d{2})/));
    if (revived) r.filings.push({ date: revived, label: 'Revived / restored', kind: 'revival' });

    const home = grab(t, /^Home Jurisdiction:\s*([^\n]+)/m);
    if (home) {
        c.extraProvincial = {
            homeJurisdiction: home,
            homeNumber: grab(t, /Home Jurisdiction CAN:\s*(\S+)/),
            formedOn: parseRegistryDate(grab(t, /Date Of Formation in Home Jurisdiction:\s*(\d{4}\/\d{2}\/\d{2})/)),
        };
        c.incorporationDate = c.extraProvincial.formedOn ?? registered;
        if (registered) r.filings.push({ date: registered, label: 'Registered extra-provincially in Alberta', kind: 'registration' });
    } else {
        c.incorporationDate = registered;
    }
    c.minDirectors = toInt(grab(t, /Min(?:imum)? Number Of Directors:\s*(\d+)/i));
    c.maxDirectors = toInt(grab(t, /Max(?:imum)? Number Of Directors:\s*(\d+)/i));

    const block = (start: RegExp) => section(lines, start, AB_SECTIONS.filter((re) => !re.test(start.source.replace(/^\^|\$$/g, '').replace(/\\/g, ''))));
    r.registeredOffice = abAddress(block(/^Registered Office:$/)) ?? abAddress(block(/^Head Office Address:$/));
    r.recordsOffice = abAddress(block(/^Records Address:$/));

    const splitOn = (blk: string[], starts: RegExp) => {
        const out: string[][] = [];
        for (const l of blk) {
            if (starts.test(l)) out.push([l]);
            else if (out.length) out[out.length - 1].push(l);
        }
        return out;
    };

    for (const p of splitOn(block(/^Directors:$/), /^Last Name:/)) {
        const firstName = abField(p, 'First Name');
        const middleName = abField(p, 'Middle Name');
        const lastName = abField(p, 'Last Name');
        r.directors.push({
            firstName, middleName, lastName,
            name: [firstName, middleName, lastName].filter(Boolean).join(' '),
            address: formatAddress(abAddress(p)),
            residentCanadian: null,
            appointedDate: null,
        });
    }

    for (const p of splitOn(block(/^Officers:$/), /^Last Name:/)) {
        const name = [abField(p, 'First Name'), abField(p, 'Middle Name'), abField(p, 'Last Name')].filter(Boolean).join(' ');
        r.officers.push({ name, title: abField(p, 'Officer Type') || 'Officer', appointedDate: null });
    }

    for (const p of splitOn(block(/^Voting Shareholders:$/), /^(Last Name|Legal Entity Name):/)) {
        const entity = abField(p, 'Legal Entity Name');
        const firstName = abField(p, 'First Name');
        const middleName = abField(p, 'Middle Name');
        const lastName = abField(p, 'Last Name');
        const pct = parseFloat(abField(p, 'Percent Of Voting Shares'));
        r.shareholders.push({
            firstName, middleName, lastName,
            name: entity || [firstName, middleName, lastName].filter(Boolean).join(' '),
            address: formatAddress(abAddress(p)),
            holderType: entity ? 'Legal Entity' : 'Individual',
            votingPercent: Number.isFinite(pct) ? pct : null,
        });
    }

    const arBlock = section(lines, /^Last Annual Return Filed:$/, AB_SECTIONS.filter((re) => !/Last Annual Return/.test(re.source)));
    for (const l of arBlock) {
        const m = l.match(/^(\d{4})\s+(\d{4}\/\d{2}\/\d{2})$/);
        if (m) r.annualReturns.push({ year: +m[1], filedOn: parseRegistryDate(m[2]) });
    }

    for (const l of section(lines, /^Filing History:$/, AB_SECTIONS.filter((re) => !/Filing History/.test(re.source)))) {
        const m = l.match(/^(\d{4}\/\d{2}\/\d{2})\s+(.+)$/);
        if (!m) continue;
        const date = parseRegistryDate(m[1])!;
        const label = m[2].trim();
        const kind = filingKind(label);
        if (kind === 'registration' && r.filings.some((f) => f.kind === 'registration' && f.date === date)) continue;
        r.filings.push({ date, label, kind });
        if (kind === 'annual_return' && !r.annualReturns.some((a) => a.filedOn === date)) {
            r.annualReturns.push({ year: +date.slice(0, 4), filedOn: date });
        }
    }
    return r;
};

// ─── Saskatchewan — ISC Corporate Registry "Profile Report" ────────────────

/** "Label Value" on one line, or the label alone with the value on the next line. */
const skField = (lines: string[], label: string): string => {
    const re = new RegExp(`^${label}\\s*:?\\s*(.*)$`, 'i');
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(re);
        if (m) return (m[1] || lines[i + 1] || '').trim();
    }
    return '';
};

export const parseSaskatchewan = (text: string): ParsedProfileReport => {
    const r = blankReport('sk', 'Saskatchewan Corporate Registry (ISC)');
    const lines = toLines(text).map((l) => l.replace(/\t/g, ' ').replace(/ {2,}/g, ' ').trim())
        .filter((l) => !/^Page \d+ of \d+$/.test(l));

    r.reportDate = parseRegistryDate(grab(text, new RegExp(`Report Date:\\s*(${DMY_DATE})`)));
    const c = r.corporation;
    c.number = grab(text, /Entity Number:\s*(\d+)/);
    c.name = grab(text, /Entity Name:\s*(.+)/);
    c.entityType = [skField(lines, 'Entity Type'), skField(lines, 'Entity Subtype')].filter(Boolean).join(' — ');
    c.status = skField(lines, 'Entity Status');
    c.businessNumber = skField(lines, 'Business Number').replace(/\s+/g, '');

    const registered = parseRegistryDate(skField(lines, 'Registration Date'));
    const homeJurisdiction = skField(lines, 'Home Jurisdiction');
    if (homeJurisdiction && !/saskatchewan/i.test(homeJurisdiction)) {
        const formedOn = parseRegistryDate(grab(text, new RegExp(`Incorporation/Amalgamation Date in Home[\\s\\S]{0,40}?(${DMY_DATE})`)));
        c.extraProvincial = {
            homeJurisdiction,
            homeNumber: skField(lines, 'Entity Number in Home Jurisdiction'),
            formedOn,
        };
        c.incorporationDate = formedOn ?? registered;
    } else {
        c.incorporationDate = parseRegistryDate(skField(lines, 'Incorporation Date')) ?? registered;
    }

    const physical = skField(lines, 'Physical Address');
    r.registeredOffice = physical ? addressFromCommas(physical) : null;

    const lastAr = parseRegistryDate(skField(lines, 'Last Annual Return(?: Filed)?'));
    if (lastAr) r.annualReturns.push({ year: +lastAr.slice(0, 4), filedOn: lastAr });

    const history = section(lines, /^Event History$/, [/^Saskatchewan$/, /^Corporate Registry$/, /^Profile Report$/]);
    const dated = new RegExp(`^(.+?)\\s+(${DMY_DATE})$`);
    for (const l of history) {
        const m = l.match(dated);
        if (!m || /^Type Date$/i.test(l)) continue;
        const date = parseRegistryDate(m[2])!;
        const label = m[1].trim();
        r.filings.push({ date, label, kind: filingKind(label) });
        if (filingKind(label) === 'annual_return' && !r.annualReturns.some((a) => a.filedOn === date)) {
            r.annualReturns.push({ year: +date.slice(0, 4), filedOn: date });
        }
    }
    r.filings.sort((a, b) => a.date.localeCompare(b.date));
    return r;
};

// ─── Entry point ────────────────────────────────────────────────────────────

const PARSERS: Record<Registry, (text: string) => ParsedProfileReport> = {
    bc: parseBc, on: parseOntario, federal: parseFederal, ab: parseAlberta, sk: parseSaskatchewan,
};

/** Reads a report's text with the matching registry parser, or null when the format isn't recognised. */
export const parseProfileReportText = (text: string): ParsedProfileReport | null => {
    const registry = detectRegistry(text);
    if (!registry) return null;
    const report = PARSERS[registry](text);
    report.filings.sort((a, b) => a.date.localeCompare(b.date));
    report.annualReturns.sort((a, b) => a.year - b.year);
    return report;
};

/** Enough was read to build a company from: the parser result can stand on its own. */
export const isUsableReport = (r: ParsedProfileReport): boolean =>
    !!r.corporation.name && !!r.corporation.number && !!r.corporation.incorporationDate;

export type { ReportDirector, ReportOfficer, ReportShareholder, ReportFiling };
