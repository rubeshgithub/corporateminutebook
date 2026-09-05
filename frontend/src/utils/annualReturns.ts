/**
 * Annual-return schedule — browser mirror of backend/src/utils/annualReturns.ts.
 * Keep the two in step; the backend copy carries the full rationale.
 *
 * Summary: the first annual return is due on the first anniversary of
 * incorporation (or the owner's MM-DD override), one per year after that,
 * and all date math is done in UTC because date-only values are stored as
 * UTC midnight and shift by a day when read in local time.
 */

export type MonthDay = [number, number];

export interface AnnualReturnSchedule {
    dueMMDD: MonthDay | null;
    firstDue: Date | null;
    pastDue: Date[];
    nextDue: Date | null;
    daysUntilNext: number | null;
}

const DAY_MS = 86_400_000;

export function parseMMDD(value: string | null | undefined): MonthDay | null {
    if (!value) return null;
    const m = String(value).trim().match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return [month, day];
}

export function utcDay(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function occurrenceIn(year: number, [month, day]: MonthDay): Date {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCMonth() !== month - 1) return new Date(Date.UTC(year, month - 1, day - 1));
    return candidate;
}

function toDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function annualReturnSchedule(opts: {
    incorporationDate?: Date | string | null;
    dueMMDD?: string | null;
    today?: Date;
}): AnnualReturnSchedule {
    const today = utcDay(opts.today ?? new Date());
    const incorporated = toDate(opts.incorporationDate);
    const incorp = incorporated ? utcDay(incorporated) : null;
    const mmdd = parseMMDD(opts.dueMMDD) ?? (incorp ? [incorp.getUTCMonth() + 1, incorp.getUTCDate()] as MonthDay : null);
    if (!mmdd) return { dueMMDD: null, firstDue: null, pastDue: [], nextDue: null, daysUntilNext: null };

    let firstDue: Date | null = null;
    if (incorp) {
        firstDue = occurrenceIn(incorp.getUTCFullYear(), mmdd);
        if (firstDue <= incorp) firstDue = occurrenceIn(incorp.getUTCFullYear() + 1, mmdd);
    }

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
    return { dueMMDD: mmdd, firstDue, pastDue, nextDue, daysUntilNext: Math.round((nextDue.getTime() - today.getTime()) / DAY_MS) };
}

/** Which due-date year a filing satisfies (explicit data.year, else the nearest due date). */
export function filingYear(filing: { effectiveDate: Date | string; data?: { year?: unknown } | null }, mmdd: MonthDay): number | null {
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
 * Format a date-only value (stored as UTC midnight) without the local-time
 * shift that turns 28 Dec into 27 Dec in every North American timezone.
 */
export function formatDateOnly(value: Date | string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
    const d = toDate(value);
    if (!d) return '';
    return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', ...options, timeZone: 'UTC' });
}
