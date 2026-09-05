import { describe, it, expect } from 'vitest';
import { annualReturnSchedule, filingYear, formatDateOnly, parseMMDD } from './annualReturns';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ymd = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

describe('annualReturnSchedule (browser mirror)', () => {
    it('first return falls on the first anniversary — incorporated 28 Dec 2025, viewed 5 Sep 2026', () => {
        const s = annualReturnSchedule({ incorporationDate: '2025-12-28T00:00:00.000Z', today: d('2026-09-05') });
        expect(s.dueMMDD).toEqual([12, 28]);
        expect(s.pastDue).toEqual([]);
        expect(ymd(s.nextDue)).toBe('2026-12-28');
        expect(s.daysUntilNext).toBe(114);
    });

    it('lists past anniversaries and the override wins over the anniversary', () => {
        const s = annualReturnSchedule({ incorporationDate: d('2023-02-10'), dueMMDD: '06-30', today: d('2026-09-05') });
        expect(s.pastDue.map(ymd)).toEqual(['2023-06-30', '2024-06-30', '2025-06-30', '2026-06-30']);
        expect(ymd(s.nextDue)).toBe('2027-06-30');
    });

    it('parses and rejects MM-DD values', () => {
        expect(parseMMDD('02-29')).toEqual([2, 29]);
        expect(parseMMDD('00-10')).toBeNull();
    });
});

describe('filingYear', () => {
    it('uses data.year when present, else the nearest anniversary', () => {
        expect(filingYear({ effectiveDate: d('2025-09-01'), data: { year: 2024 } }, [2, 10])).toBe(2024);
        expect(filingYear({ effectiveDate: d('2025-01-20') }, [2, 10])).toBe(2025);
        expect(filingYear({ effectiveDate: d('2025-09-01') }, [2, 10])).toBe(2026);
    });
});

describe('formatDateOnly', () => {
    it('renders a UTC-midnight date as the same calendar day regardless of the viewer timezone', () => {
        expect(formatDateOnly('2025-12-28T00:00:00.000Z')).toBe('December 28, 2025');
        expect(formatDateOnly('2025-12-28T00:00:00.000Z', { month: 'short' })).toBe('Dec 28, 2025');
    });
    it('returns an empty string for missing or invalid input', () => {
        expect(formatDateOnly(undefined)).toBe('');
        expect(formatDateOnly('not a date')).toBe('');
    });
});
