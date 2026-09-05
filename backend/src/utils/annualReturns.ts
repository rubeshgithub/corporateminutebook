/**
 * Annual-return schedule and compliance.
 *
 * Canadian corporate registries require an annual return once a year, keyed
 * to the anniversary of incorporation (Alberta: during the anniversary month;
 * CBCA: within 60 days after it; BC: within two months after it). MinuteBook
 * models the obligation as falling due on the anniversary date itself — or on
 * the MM-DD the owner overrides — and the FIRST return is due on the FIRST
 * anniversary, never earlier.
 *
 * Before this module the compliance summary treated the most recent past
 * occurrence of the MM-DD as an unmet obligation even when that date preceded
 * incorporation (a company incorporated 28 Dec 2025 showed "overdue" for all
 * of 2026), and expected returns were counted per fiscal year-end, which put
 * a return three days after incorporation for a Dec 28 incorporation with a
 * Dec 31 year-end.
 *
 * All arithmetic is in UTC. Date-only values (incorporation date, event
 * effective dates) are stored as UTC midnight; doing the math in local time
 * shifts them by a day in every North American timezone.
 *
 * Mirrored in frontend/src/utils/annualReturns.ts — keep the two in step.
 */

export type MonthDay = [number, number];

export type AnnualReturnStatus = 'not_set' | 'ok' | 'due_soon' | 'overdue';

export interface AnnualReturnSchedule {
    /** Month/day the return falls due each year, or null when unknown. */
    dueMMDD: MonthDay | null;
    /** First anniversary on which a return is due (null without an incorporation date). */
    firstDue: Date | null;
    /** Due dates strictly before today, ascending. */
    pastDue: Date[];
    /** Next due date on or after today. */
    nextDue: Date | null;
    /** Whole days from today to nextDue (0 = due today). */
    daysUntilNext: number | null;
}

export interface AnnualReturnFiling {
    effectiveDate: Date | string;
    data?: { year?: unknown } | null;
}

export interface AnnualReturnCompliance extends AnnualReturnSchedule {
    status: AnnualReturnStatus;
    /** Years (of the due date) for which a return has fallen due. */
    expectedYears: number[];
    /** Years satisfied by a recorded filing. */
    filedYears: number[];
    /** Expected years with no matching filing, ascending. */
    missingYears: number[];
}

const DAY_MS = 86_400_000;
export const DUE_SOON_DAYS = 30;

/** "MM-DD" → [month, day], or null when malformed. */
export function parseMMDD(value: string | null | undefined): MonthDay | null {
    if (!value) return null;
    const m = String(value).trim().match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return [month, day];
}

/** Midnight UTC of the given instant. */
export function utcDay(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Month/day of a date, in UTC. */
export function anniversaryOf(d: Date): MonthDay {
    return [d.getUTCMonth() + 1, d.getUTCDate()];
}

/** The MM-DD in a given year, clamping Feb 29 to Feb 28 in non-leap years. */
export function occurrenceIn(year: number, [month, day]: MonthDay): Date {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    // Date.UTC rolls an invalid day forward (Feb 29 → Mar 1); clamp instead.
    if (candidate.getUTCMonth() !== month - 1) return new Date(Date.UTC(year, month - 1, day - 1));
    return candidate;
}

function toDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The schedule of due dates. `dueMMDD` (the owner's override) wins over the
 * incorporation anniversary; without either there is no schedule.
 */
export function annualReturnSchedule(opts: {
    incorporationDate?: Date | string | null;
    dueMMDD?: string | null;
    today?: Date;
}): AnnualReturnSchedule {
    const today = utcDay(opts.today ?? new Date());
    const incorporated = toDate(opts.incorporationDate);
    const incorp = incorporated ? utcDay(incorporated) : null;
    const mmdd = parseMMDD(opts.dueMMDD) ?? (incorp ? anniversaryOf(incorp) : null);
    if (!mmdd) return { dueMMDD: null, firstDue: null, pastDue: [], nextDue: null, daysUntilNext: null };

    let firstDue: Date | null = null;
    if (incorp) {
        firstDue = occurrenceIn(incorp.getUTCFullYear(), mmdd);
        if (firstDue <= incorp) firstDue = occurrenceIn(incorp.getUTCFullYear() + 1, mmdd);
    }

    // Without an incorporation date we cannot know when the obligation began.
    // Assume exactly one past cycle — the most recent occurrence — which is
    // what the summary did before and errs toward flagging.
    let cursor: Date;
    if (firstDue) {
        cursor = firstDue;
    } else {
        const thisYear = occurrenceIn(today.getUTCFullYear(), mmdd);
        cursor = thisYear < today ? thisYear : occurrenceIn(today.getUTCFullYear() - 1, mmdd);
    }

    const pastDue: Date[] = [];
    while (cursor < today) {
        pastDue.push(cursor);
        cursor = occurrenceIn(cursor.getUTCFullYear() + 1, mmdd);
    }
    const nextDue = cursor;
    const daysUntilNext = Math.round((nextDue.getTime() - today.getTime()) / DAY_MS);
    return { dueMMDD: mmdd, firstDue, pastDue, nextDue, daysUntilNext };
}

/**
 * Which due-date year a filing satisfies: the explicit `data.year` when the
 * owner set one, otherwise the due date nearest to the filing's effective
 * date — so a return filed three weeks early or two months late still lands
 * on the cycle it was for.
 */
export function filingYear(filing: AnnualReturnFiling, mmdd: MonthDay): number | null {
    const explicit = filing.data?.year;
    if (explicit != null && explicit !== '' && !Number.isNaN(Number(explicit))) return Number(explicit);
    const eff = toDate(filing.effectiveDate);
    if (!eff) return null;
    const day = utcDay(eff);
    const y = day.getUTCFullYear();
    let best: Date | null = null;
    for (const candidate of [y - 1, y, y + 1].map((yy) => occurrenceIn(yy, mmdd))) {
        if (!best || Math.abs(candidate.getTime() - day.getTime()) < Math.abs(best.getTime() - day.getTime())) best = candidate;
    }
    return best!.getUTCFullYear();
}

/**
 * Compliance verdict for one company.
 *
 *   overdue   the most recent past due date has no filing
 *   due_soon  the next due date is within DUE_SOON_DAYS and not yet filed
 *   ok        otherwise (including "first anniversary still ahead")
 *   not_set   no incorporation date and no due-date override
 *
 * `missingYears` lists every unfiled past cycle, not just the latest, so
 * older gaps still count as issues without flipping the headline status.
 */
export function annualReturnCompliance(opts: {
    incorporationDate?: Date | string | null;
    dueMMDD?: string | null;
    filings: AnnualReturnFiling[];
    today?: Date;
}): AnnualReturnCompliance {
    const schedule = annualReturnSchedule(opts);
    if (!schedule.dueMMDD || !schedule.nextDue) {
        return { ...schedule, status: 'not_set', expectedYears: [], filedYears: [], missingYears: [] };
    }

    const filed = new Set<number>();
    for (const f of opts.filings) {
        const y = filingYear(f, schedule.dueMMDD);
        if (y != null) filed.add(y);
    }

    const expectedYears = schedule.pastDue.map((d) => d.getUTCFullYear());
    const missingYears = expectedYears.filter((y) => !filed.has(y));
    const latestPast = expectedYears[expectedYears.length - 1];
    const nextYear = schedule.nextDue.getUTCFullYear();

    let status: AnnualReturnStatus = 'ok';
    if (latestPast !== undefined && !filed.has(latestPast)) status = 'overdue';
    else if (schedule.daysUntilNext !== null && schedule.daysUntilNext <= DUE_SOON_DAYS && !filed.has(nextYear)) status = 'due_soon';

    return {
        ...schedule,
        status,
        expectedYears,
        filedYears: [...filed].sort((a, b) => a - b),
        missingYears,
    };
}
