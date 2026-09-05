import { describe, it, expect } from 'vitest';
import {
    parseMMDD, occurrenceIn, annualReturnSchedule, annualReturnCompliance, filingYear,
} from '../src/utils/annualReturns';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ymd = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

describe('parseMMDD / occurrenceIn', () => {
    it('parses MM-DD and rejects junk', () => {
        expect(parseMMDD('12-28')).toEqual([12, 28]);
        expect(parseMMDD('1-5')).toEqual([1, 5]);
        expect(parseMMDD('13-01')).toBeNull();
        expect(parseMMDD('12-32')).toBeNull();
        expect(parseMMDD('December 28')).toBeNull();
        expect(parseMMDD('')).toBeNull();
        expect(parseMMDD(undefined)).toBeNull();
    });

    it('clamps Feb 29 to Feb 28 in non-leap years', () => {
        expect(ymd(occurrenceIn(2024, [2, 29]))).toBe('2024-02-29');
        expect(ymd(occurrenceIn(2025, [2, 29]))).toBe('2025-02-28');
    });
});

describe('annualReturnSchedule — the founder\'s example', () => {
    // Incorporated 28 Dec 2025, looked at on 5 Sep 2026.
    const s = annualReturnSchedule({ incorporationDate: d('2025-12-28'), today: d('2026-09-05') });

    it('puts the first return on the first anniversary, not the previous 28 Dec', () => {
        expect(ymd(s.firstDue)).toBe('2026-12-28');
        expect(s.pastDue).toEqual([]);
    });

    it('counts down to that first anniversary', () => {
        expect(ymd(s.nextDue)).toBe('2026-12-28');
        expect(s.daysUntilNext).toBe(114);
    });
});

describe('annualReturnSchedule — general', () => {
    it('derives the due month/day from the incorporation date in UTC', () => {
        // Stored as UTC midnight; a local-time reading in North America would say Dec 27.
        const s = annualReturnSchedule({ incorporationDate: '2025-12-28T00:00:00.000Z', today: d('2026-01-01') });
        expect(s.dueMMDD).toEqual([12, 28]);
    });

    it('lets an explicit MM-DD override the anniversary', () => {
        const s = annualReturnSchedule({ incorporationDate: d('2023-02-10'), dueMMDD: '06-30', today: d('2026-09-05') });
        expect(s.dueMMDD).toEqual([6, 30]);
        expect(ymd(s.firstDue)).toBe('2023-06-30');
        expect(s.pastDue.map(ymd)).toEqual(['2023-06-30', '2024-06-30', '2025-06-30', '2026-06-30']);
        expect(ymd(s.nextDue)).toBe('2027-06-30');
    });

    it('lists every past anniversary since incorporation', () => {
        const s = annualReturnSchedule({ incorporationDate: d('2023-02-10'), today: d('2026-09-05') });
        expect(s.pastDue.map(ymd)).toEqual(['2024-02-10', '2025-02-10', '2026-02-10']);
        expect(ymd(s.nextDue)).toBe('2027-02-10');
    });

    it('treats a return due today as due today, not past', () => {
        const s = annualReturnSchedule({ incorporationDate: d('2025-09-05'), today: d('2026-09-05') });
        expect(s.pastDue).toEqual([]);
        expect(ymd(s.nextDue)).toBe('2026-09-05');
        expect(s.daysUntilNext).toBe(0);
    });

    it('falls back to one past cycle when only the MM-DD is known', () => {
        const s = annualReturnSchedule({ dueMMDD: '03-15', today: d('2026-09-05') });
        expect(s.firstDue).toBeNull();
        expect(s.pastDue.map(ymd)).toEqual(['2026-03-15']);
        expect(ymd(s.nextDue)).toBe('2027-03-15');
    });

    it('has no schedule with neither an incorporation date nor an override', () => {
        const s = annualReturnSchedule({ today: d('2026-09-05') });
        expect(s.dueMMDD).toBeNull();
        expect(s.nextDue).toBeNull();
    });

    it('ignores the time-of-day of "today"', () => {
        const late = annualReturnSchedule({ incorporationDate: d('2025-12-28'), today: new Date('2026-09-05T23:59:59.000Z') });
        expect(late.daysUntilNext).toBe(114);
    });
});

describe('filingYear', () => {
    const mmdd: [number, number] = [2, 10];
    it('honours an explicit data.year', () => {
        expect(filingYear({ effectiveDate: d('2025-09-01'), data: { year: 2024 } }, mmdd)).toBe(2024);
        expect(filingYear({ effectiveDate: d('2025-09-01'), data: { year: '2024' } }, mmdd)).toBe(2024);
    });
    it('otherwise assigns the nearest due date — early or late filings included', () => {
        expect(filingYear({ effectiveDate: d('2025-01-20') }, mmdd)).toBe(2025);   // three weeks early
        expect(filingYear({ effectiveDate: d('2025-04-15') }, mmdd)).toBe(2025);   // two months late
        expect(filingYear({ effectiveDate: d('2025-09-01') }, mmdd)).toBe(2026);   // closer to the next one
    });
    it('returns null for an unparseable date', () => {
        expect(filingYear({ effectiveDate: 'yesterday' }, mmdd)).toBeNull();
    });
});

describe('annualReturnCompliance', () => {
    it('is ok, not overdue, before the first anniversary (the reported bug)', () => {
        const c = annualReturnCompliance({ incorporationDate: d('2025-12-28'), filings: [], today: d('2026-09-05') });
        expect(c.status).toBe('ok');
        expect(c.expectedYears).toEqual([]);
        expect(c.missingYears).toEqual([]);
        expect(c.daysUntilNext).toBe(114);
    });

    it('does not expect a return at the first fiscal year-end', () => {
        // Dec 28 incorporation, Dec 31 FYE: the old fiscal-year model wanted a return for 2025.
        const c = annualReturnCompliance({ incorporationDate: d('2025-12-28'), filings: [], today: d('2026-03-01') });
        expect(c.expectedYears).toEqual([]);
        expect(c.status).toBe('ok');
    });

    it('turns due_soon inside 30 days of the first anniversary', () => {
        const c = annualReturnCompliance({ incorporationDate: d('2025-12-28'), filings: [], today: d('2026-12-10') });
        expect(c.status).toBe('due_soon');
        expect(c.daysUntilNext).toBe(18);
    });

    it('is ok inside the 30-day window when the upcoming return was filed early', () => {
        const c = annualReturnCompliance({
            incorporationDate: d('2025-12-28'), today: d('2026-12-10'),
            filings: [{ effectiveDate: d('2026-12-05') }],
        });
        expect(c.status).toBe('ok');
        expect(c.filedYears).toEqual([2026]);
    });

    it('goes overdue the day after an unfiled anniversary', () => {
        const c = annualReturnCompliance({ incorporationDate: d('2025-12-28'), filings: [], today: d('2026-12-29') });
        expect(c.status).toBe('overdue');
        expect(c.expectedYears).toEqual([2026]);
        expect(c.missingYears).toEqual([2026]);
        expect(c.daysUntilNext).toBe(364);
    });

    it('clears overdue once the return is logged, even late', () => {
        const c = annualReturnCompliance({
            incorporationDate: d('2025-12-28'), today: d('2027-02-15'),
            filings: [{ effectiveDate: d('2027-02-14') }],
        });
        expect(c.status).toBe('ok');
        expect(c.missingYears).toEqual([]);
    });

    it('keeps older gaps as missing years without making the headline overdue', () => {
        const c = annualReturnCompliance({
            incorporationDate: d('2023-02-10'), today: d('2026-09-05'),
            filings: [
                { effectiveDate: d('2024-02-12'), data: { year: 2024 } },
                { effectiveDate: d('2026-02-11'), data: { year: 2026 } },
            ],
        });
        expect(c.expectedYears).toEqual([2024, 2025, 2026]);
        expect(c.missingYears).toEqual([2025]);
        expect(c.status).toBe('ok');
    });

    it('is not_set without any date information', () => {
        const c = annualReturnCompliance({ filings: [], today: d('2026-09-05') });
        expect(c.status).toBe('not_set');
        expect(c.daysUntilNext).toBeNull();
    });
});
