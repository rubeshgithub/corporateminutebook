import { formatAddress } from './parsers';
import type { ParsedProfileReport, Registry, ReportAddress } from './types';

export type Jurisdiction = Registry | 'other';

export interface ImportFlag {
    /** blocker: import refused · warning: shown prominently · info: good to know */
    level: 'blocker' | 'warning' | 'info';
    code: string;
    message: string;
}

export interface ImportEvent {
    eventType: string;
    effectiveDate: string;
    data: Record<string, unknown>;
    notes: string;
    registryFilingNotApplicable: boolean;
    /** Plain-language line for the review screen. */
    label: string;
}

export interface ImportPlan {
    jurisdiction: Jurisdiction;
    reportAgeDays: number | null;
    company: Record<string, any>;
    events: ImportEvent[];
    flags: ImportFlag[];
}

export const STALE_AFTER_DAYS = 30;

const DAY = 24 * 60 * 60 * 1000;
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (iso: string) => dateOnly(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const list = (xs: Array<string | number>) =>
    xs.length <= 1 ? String(xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

const REGISTRY_LABEL: Record<Registry, string> = {
    ab: 'Alberta', bc: 'British Columbia', on: 'Ontario', sk: 'Saskatchewan', federal: 'Canada (federal)',
};

/** How the governing law reads in a sentence: "governed by …". */
const GOVERNING_LAW: Record<Registry, string> = {
    ab: 'Alberta\'s Business Corporations Act',
    bc: 'British Columbia\'s Business Corporations Act',
    on: 'Ontario\'s Business Corporations Act',
    sk: 'Saskatchewan\'s Business Corporations Act, 2021',
    federal: 'the Canada Business Corporations Act',
};

/** The report to upload from the home registry. */
const HOME_REPORT: Record<Registry, string> = {
    ab: 'Alberta corporate search',
    bc: 'BC company summary',
    on: 'Ontario profile report',
    sk: 'Saskatchewan profile report',
    federal: 'Corporations Canada corporate profile',
};

/** Maps a home-jurisdiction string from an extra-provincial report to a jurisdiction. */
export const jurisdictionFromHome = (home: string): Jurisdiction => {
    const h = home.toLowerCase();
    if (/^canada$|federal|cbca/.test(h.trim()) || h.trim() === 'canada') return 'federal';
    if (h.includes('alberta')) return 'ab';
    if (h.includes('british columbia')) return 'bc';
    if (h.includes('ontario')) return 'on';
    if (h.includes('saskatchewan')) return 'sk';
    return 'other';
};

const NON_BUSINESS = /society|non-profit|not-for-profit|nonprofit|co-?operative|partnership|extra-provincial non-profit/i;
const INACTIVE_OK = /^active$/i;

/** Anniversary MM-DD for annual filings: stated on the report, else the incorporation date. */
const anniversaryOf = (r: ParsedProfileReport): string | null =>
    r.annualReturnAnniversary ?? (r.corporation.incorporationDate ? r.corporation.incorporationDate.slice(5) : null);

/** Annual returns that appear missing, by the registry's own filing rule. */
export const missingAnnualReturns = (r: ParsedProfileReport, now: Date): number[] => {
    const inc = r.corporation.incorporationDate;
    if (!inc) return [];
    const filed = new Set(r.annualReturns.map((a) => a.year));
    const incYear = +inc.slice(0, 4);
    const anniv = anniversaryOf(r)!;
    const years: number[] = [];

    if (r.registry === 'on') {
        // Ontario returns are due within six months after each fiscal year-end;
        // with the year-end unknown, only years that have fully closed count.
        for (let y = incYear + 1; y <= now.getUTCFullYear() - 1; y++) if (!filed.has(y)) years.push(y);
        return years;
    }
    if (r.registry === 'federal') return [...r.annualReturnsOutstanding];

    // Anniversary-based registries: count a year once its filing window has closed.
    const graceMonths = r.registry === 'bc' ? 2 : r.registry === 'sk' ? 2 : 1;
    const latestKnown = Math.max(0, ...r.annualReturns.map((a) => a.year));
    for (let y = incYear + 1; y <= now.getUTCFullYear(); y++) {
        const due = dateOnly(`${y}-${anniv}`);
        due.setUTCMonth(due.getUTCMonth() + graceMonths);
        if (due.getTime() > now.getTime()) continue;
        if (filed.has(y)) continue;
        // BC only shows the latest report: years before it are unknown, not missing.
        if (r.registry === 'bc' && !r.noAnnualReturnOnFile && y < latestKnown) continue;
        years.push(y);
    }
    return years;
};

const residentFor = (address: string, stated: boolean | null): boolean =>
    stated ?? /canada\s*$/i.test(address.trim());

export const buildImportPlan = (r: ParsedProfileReport, now: Date = new Date(), opts: { unreadPages?: number[] } = {}): ImportPlan => {
    const flags: ImportFlag[] = [];
    const events: ImportEvent[] = [];
    const c = r.corporation;
    const inc = c.incorporationDate;

    // ── Which statute governs the book ────────────────────────────────────
    let jurisdiction: Jurisdiction = r.registry;
    if (c.extraProvincial) {
        jurisdiction = jurisdictionFromHome(c.extraProvincial.homeJurisdiction);
        const known = jurisdiction !== 'other';
        const law = known ? GOVERNING_LAW[jurisdiction as Registry] : `the law of ${c.extraProvincial.homeJurisdiction}`;
        const homeReport = known ? HOME_REPORT[jurisdiction as Registry] : `${c.extraProvincial.homeJurisdiction} registry report`;
        flags.push({
            level: 'blocker',
            code: 'extra_provincial',
            message: `This report is ${c.name}'s extra-provincial registration in ${REGISTRY_LABEL[r.registry]}. The corporation itself is governed by ${law}` +
                `${c.extraProvincial.homeNumber ? ` (number ${c.extraProvincial.homeNumber})` : ''}, and its minute book follows that statute. ` +
                `Upload its ${homeReport} to build the book, and keep this report as its ${REGISTRY_LABEL[r.registry]} registration record.`,
        });
    }
    const isBusiness = !NON_BUSINESS.test(c.entityType);
    if (!isBusiness) {
        flags.push({
            level: 'blocker',
            code: 'not_a_business_corporation',
            message: `${c.name} is registered as "${c.entityType}". MinuteBook builds share-based corporate minute books; records for societies, non-profits and co-operatives aren't supported yet.`,
        });
    }
    if (!inc) {
        flags.push({ level: 'blocker', code: 'no_incorporation_date', message: 'The incorporation date could not be read from this report.' });
    }

    // ── Report quality ────────────────────────────────────────────────────
    let reportAgeDays: number | null = null;
    if (r.reportDate) {
        reportAgeDays = Math.floor((now.getTime() - dateOnly(r.reportDate).getTime()) / DAY);
        if (reportAgeDays > STALE_AFTER_DAYS) {
            flags.push({
                level: 'warning',
                code: 'stale_report',
                message: `This report is ${reportAgeDays} days old (dated ${fmt(r.reportDate)}). A minute book should start from a report under ${STALE_AFTER_DAYS} days old — changes since then won't be in it. Order a current report before relying on the book.`,
            });
        }
    } else {
        flags.push({ level: 'warning', code: 'undated_report', message: 'The report date could not be read, so its currency can\'t be checked.' });
    }
    if (opts.unreadPages?.length) {
        flags.push({
            level: 'warning',
            code: 'unread_pages',
            message: `Page${opts.unreadPages.length > 1 ? 's' : ''} ${list(opts.unreadPages)} of this PDF ${opts.unreadPages.length > 1 ? 'are' : 'is a'} scanned image${opts.unreadPages.length > 1 ? 's' : ''} and couldn't be read. Officers, shareholders or filings on ${opts.unreadPages.length > 1 ? 'those pages' : 'that page'} are missing — upload a text PDF from the registry or add them after import.`,
        });
    }
    if (r.source === 'ai') {
        flags.push({ level: 'warning', code: 'read_by_ai', message: 'This report format was read by AI rather than an exact reader. Check every name, date and address below against the report.' });
    }
    if (c.status && !INACTIVE_OK.test(c.status)) {
        flags.push({ level: 'warning', code: 'not_active', message: `The registry shows the corporation as "${c.status}", not active.` });
    }

    // ── Directors and officers ───────────────────────────────────────────
    const directors = r.directors.map((d) => ({
        name: d.name, firstName: d.firstName, middleName: d.middleName, lastName: d.lastName,
        address: d.address,
        residentCanadian: residentFor(d.address, d.residentCanadian),
        appointedDate: d.appointedDate ?? inc,
    }));
    if (inc) {
        for (const d of r.directors) {
            const date = d.appointedDate ?? inc;
            events.push({
                eventType: 'director_appointed',
                effectiveDate: date,
                data: { firstName: d.firstName, middleName: d.middleName, lastName: d.lastName, address: d.address, residentCanadian: residentFor(d.address, d.residentCanadian) },
                notes: d.appointedDate ? 'From the registry profile report.' : 'From the registry profile report — appointment date not shown; recorded as the incorporation date.',
                registryFilingNotApplicable: date === inc,
                label: `${d.name} — director since ${fmt(date)}${d.appointedDate ? '' : ' (assumed)'}`,
            });
        }
        for (const o of r.officers) {
            const date = o.appointedDate ?? inc;
            events.push({
                eventType: 'officer_appointed',
                effectiveDate: date,
                data: { name: o.name, title: o.title },
                notes: o.appointedDate ? 'From the registry profile report.' : 'From the registry profile report — appointment date not shown; recorded as the incorporation date.',
                registryFilingNotApplicable: true,
                label: `${o.name} — ${o.title} since ${fmt(date)}${o.appointedDate ? '' : ' (assumed)'}`,
            });
        }
    }
    if (r.directors.length && r.directors.some((d) => !d.appointedDate)) {
        flags.push({
            level: 'info',
            code: 'director_dates_assumed',
            message: 'This registry doesn\'t show when directors were appointed, so they are recorded as directors since incorporation. Correct anyone who joined later.',
        });
    }
    if (jurisdiction === 'federal' && r.directors.length) {
        flags.push({
            level: 'info',
            code: 'residency_check',
            message: 'Federal corporations need at least 25% resident Canadian directors. Residency isn\'t on the report — it has been set from each director\'s address; confirm it.',
        });
    }

    // ── Annual returns ───────────────────────────────────────────────────
    const anniv = anniversaryOf(r);
    for (const a of r.annualReturns) {
        const date = a.filedOn ?? (anniv ? `${a.year}-${anniv}` : null);
        if (!date) continue;
        events.push({
            eventType: 'annual_return_filed',
            effectiveDate: date,
            data: { year: a.year },
            notes: a.filedOn
                ? 'Filed per the registry profile report — upload the filing confirmation.'
                : 'Shown as filed on the registry profile report (filing date not given) — upload the filing confirmation.',
            registryFilingNotApplicable: false,
            label: `Annual return ${a.year}${a.filedOn ? ` — filed ${fmt(a.filedOn)}` : ' — filed'}`,
        });
    }
    // With pages unread the filing history is incomplete, so absence proves nothing.
    const historyComplete = !opts.unreadPages?.length;
    const missing = inc && !c.extraProvincial && isBusiness && historyComplete ? missingAnnualReturns(r, now) : [];
    if (missing.length) {
        flags.push({
            level: 'warning',
            code: 'annual_returns_missing',
            message: `No annual return is on record for ${list(missing)}. If ${missing.length > 1 ? 'they were' : 'it was'} filed, upload the confirmation${missing.length > 1 ? 's' : ''}; if not, file now — overdue returns can lead to the corporation being struck.`,
        });
    }
    if (r.registry === 'on') {
        const late = r.annualReturns.filter((a) => a.filedOn && dateOnly(a.filedOn).getTime() > Date.UTC(a.year + 1, 11, 31));
        if (late.length) {
            flags.push({
                level: 'warning',
                code: 'annual_returns_late',
                message: `The annual returns for ${list(late.map((a) => a.year))} were filed late (${list(late.map((a) => `${a.year} on ${fmt(a.filedOn!)}`))}). Keep any penalty or reminder notices with the book.`,
            });
        }
    }
    if (r.registry === 'bc' && !r.noAnnualReturnOnFile && r.annualReturns.length) {
        flags.push({ level: 'info', code: 'earlier_returns_not_listed', message: 'BC company summaries only show the most recent annual report. Upload confirmations for earlier years.' });
    }
    if (r.registry === 'federal' && r.annualReturns.length) {
        flags.push({ level: 'info', code: 'recent_returns_only', message: 'Corporations Canada only lists recent annual filings. Upload confirmations for earlier years.' });
    }

    // ── Name history, revival, other filings ─────────────────────────────
    const names = [...r.nameHistory].sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
    for (let i = 1; i < names.length; i++) {
        if (!names[i].from) continue;
        events.push({
            eventType: 'name_changed',
            effectiveDate: names[i].from!,
            data: { newName: names[i].name, previousName: names[i - 1].name },
            notes: 'Name change from the registry profile report.',
            registryFilingNotApplicable: false,
            label: `Name changed to ${names[i].name} on ${fmt(names[i].from!)}`,
        });
    }
    for (const f of r.filings.filter((x) => x.kind === 'revival')) {
        events.push({
            eventType: 'revival_filed',
            effectiveDate: f.date,
            data: {},
            notes: 'Revival / restoration shown on the registry profile report.',
            registryFilingNotApplicable: false,
            label: `Revived / restored on ${fmt(f.date)}`,
        });
        flags.push({
            level: 'warning',
            code: 'revived',
            message: `The corporation was revived or restored on ${fmt(f.date)}. Acts during the period it was dissolved need ratifying — lawyer review recommended.`,
        });
    }
    const unmatched = r.filings.filter((f) => ['change', 'amendment', 'status', 'other'].includes(f.kind));
    if (unmatched.length) {
        flags.push({
            level: 'info',
            code: 'filings_to_record',
            message: `The registry shows filings that need matching records: ${list(unmatched.map((f) => `${f.label} (${fmt(f.date)})`))}. Record what each one changed from the Records page.`,
        });
    }

    // ── What the registry never records ──────────────────────────────────
    const shareholders = r.shareholders.map((s) => ({
        name: s.name, holderType: s.holderType, address: s.address, votingPercent: s.votingPercent ?? undefined, sharesClass: '',
    }));
    if (isBusiness) {
        flags.push(r.shareholders.length
            ? { level: 'info', code: 'share_numbers_needed', message: 'The report lists voting shareholders by percentage only. Add the share classes, number of shares and certificate numbers before approval.' }
            : { level: 'info', code: 'shareholders_needed', message: 'This registry doesn\'t record shareholders. Add the share classes and shareholders before approval.' });
    }
    if (/professional corporation/i.test(c.name)) {
        flags.push({ level: 'info', code: 'professional_corporation', message: 'This is a professional corporation — its regulator (e.g. the College) restricts who may hold shares and serve as director or officer.' });
    }
    if (r.significantIndividuals.length) {
        flags.push({
            level: 'info',
            code: 'significant_control_on_record',
            message: `Individuals with significant control on the registry: ${list(r.significantIndividuals.map((s) => `${s.name}${s.description ? ` (${s.description})` : ''}`))}. Your shareholder register should agree with this.`,
        });
    }

    const office: ReportAddress = r.registeredOffice ?? { street: '', city: '', province: '', postalCode: '', country: 'Canada' };
    const sameRecords = !r.recordsOffice || formatAddress(r.recordsOffice) === formatAddress(r.registeredOffice);
    const company: Record<string, any> = {
        name: c.name,
        corporateAccessNumber: c.number,
        businessNumber: c.businessNumber || undefined,
        incorporationDate: inc,
        jurisdiction,
        registeredOfficeAddress: office,
        recordsAddress: sameRecords ? { sameAsRegistered: true } : { sameAsRegistered: false, ...r.recordsOffice },
        addressForService: { sameAsRegistered: true },
        minDirectors: c.minDirectors ?? undefined,
        maxDirectors: c.maxDirectors ?? undefined,
        directors,
        officers: r.officers.map((o) => ({ name: o.name, title: o.title, appointedDate: o.appointedDate ?? inc })),
        shareholders,
        ...(r.registry !== 'on' && anniv ? { annualReturnDueDate: anniv } : {}),
        registrySignature: { provinceKey: r.registry, registryId: c.number },
    };

    events.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    return { jurisdiction, reportAgeDays, company, events, flags };
};

export const hasBlocker = (plan: ImportPlan) => plan.flags.some((f) => f.level === 'blocker');
