import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { Company } from '../models/Company';
import { ActivityLog } from '../models/ActivityLog';
import { CorporateEvent } from '../models/CorporateEvent';
import { serverError } from '../utils/apiError';

const ACTIVE = { deletedAt: null };

const assignCertNumbers = (shareholders: any[], startFrom = 1): any[] => {
    let next = startFrom;
    return shareholders.map((s) => {
        if (s.certificateNumber) return s;
        return { ...s, certificateNumber: next++ };
    });
};

const createFoundingEvents = async (company: any, userId: string) => {
    const effectiveDate = company.incorporationDate ? new Date(company.incorporationDate) : new Date();
    const events: any[] = [];

    // Founding events all get registryFilingNotApplicable=true — they were
    // recorded as part of the incorporation filing itself, so there's no
    // separate registry filing to attach. Otherwise the compliance chip
    // shows N gaps for every founding director/officer/shareholder from
    // day one, which is nonsense.
    for (const d of company.directors || []) {
        events.push({
            companyId: company._id,
            userId,
            eventType: 'director_appointed',
            effectiveDate,
            data: {
                firstName: d.firstName || '',
                middleName: d.middleName || '',
                lastName: d.lastName || '',
                address: [d.address, d.city, d.province, d.postalCode, d.country].filter(Boolean).join(', '),
                residentCanadian: d.residentCanadian ?? true,
            },
            notes: 'Founding',
            registryFilingNotApplicable: true,
        });
    }

    for (const o of company.officers || []) {
        events.push({
            companyId: company._id,
            userId,
            eventType: 'officer_appointed',
            effectiveDate,
            data: { name: o.name || '', title: o.title || '' },
            notes: 'Founding',
            registryFilingNotApplicable: true,
        });
    }

    for (const s of company.shareholders || []) {
        // Every shares_issued event must carry a real count and class — the
        // event API now enforces that, and these founding events land in the
        // same collection and print through the same ledger templates.
        // numberOfShares is optional on the shareholder schema, so an
        // incomplete record would otherwise seed a "0  → Jane Doe" row into
        // the compiled minute book. Skip the event rather than fabricate a
        // class or a count; the shareholder itself is still on the company,
        // so the share register renders them either way.
        const numberOfShares = s.numberOfShares || 0;
        const sharesClass = s.sharesClass || '';
        if (numberOfShares <= 0 || !sharesClass.trim()) continue;

        events.push({
            companyId: company._id,
            userId,
            eventType: 'shares_issued',
            effectiveDate: s.issuanceDate ? new Date(s.issuanceDate) : effectiveDate,
            data: {
                name: s.name || '',
                numberOfShares,
                sharesClass,
                considerationPaid: s.considerationPaid || 0,
                certificateNumber: s.certificateNumber,
            },
            notes: 'Founding',
            registryFilingNotApplicable: true,
        });
    }

    if (events.length > 0) await CorporateEvent.insertMany(events);
};

export const createCompany = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const companyData = req.body;

        if (Array.isArray(companyData.shareholders)) {
            companyData.shareholders = assignCertNumbers(companyData.shareholders, 1);
        }

        const company = await Company.create({ ...companyData, userId });

        await createFoundingEvents(company, userId!);

        await ActivityLog.create({
            userId,
            companyId: company._id,
            action: 'CREATED_COMPANY',
            details: `Company ${company.name} created.`,
        });

        res.status(201).json(company);
    } catch (error: any) {
        serverError(res, 'createCompany', error);
    }
};

export const getCompanies = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const companies = await Company.find({ userId, ...ACTIVE });
        res.json(companies);
    } catch (error: any) {
        serverError(res, 'getCompanies', error);
    }
};

export const getCompany = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const company = await Company.findOne({ _id: req.params.id, userId, ...ACTIVE });
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        res.json(company);
    } catch (error: any) {
        serverError(res, 'getCompany', error);
    }
};

export const updateCompany = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { userId: _ignoreUserId, _id: _ignoreId, deletedAt: _ignoreDeleted, ...updates } = req.body;

        if (Array.isArray(updates.shareholders)) {
            const existing = await Company.findOne({ _id: req.params.id, userId, ...ACTIVE });
            const existingShareholders = existing?.shareholders ?? [];
            // A row resubmitted without its certificateNumber reclaims the number
            // already on record for that holder+class — assigning a fresh one here
            // would contradict the issuance events the share ledger renders from.
            updates.shareholders = updates.shareholders.map((s: any) => {
                if (s.certificateNumber) return s;
                const prior = existingShareholders.find(
                    (e: any) => e.name === s.name && e.sharesClass === s.sharesClass,
                );
                return prior?.certificateNumber ? { ...s, certificateNumber: prior.certificateNumber } : s;
            });
            const maxExisting = [...existingShareholders, ...updates.shareholders].reduce(
                (max: number, s: any) => Math.max(max, s.certificateNumber || 0), 0
            );
            updates.shareholders = assignCertNumbers(updates.shareholders, maxExisting + 1);
        }

        const company = await Company.findOneAndUpdate(
            { _id: req.params.id, userId, ...ACTIVE },
            updates,
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        await ActivityLog.create({
            userId,
            companyId: company._id,
            action: 'UPDATED_COMPANY',
            details: `Company ${company.name} updated.`,
        });

        res.json(company);
    } catch (error: any) {
        serverError(res, 'updateCompany', error);
    }
};

export const deleteCompany = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const company = await Company.findOneAndUpdate(
            { _id: req.params.id, userId, ...ACTIVE },
            { deletedAt: new Date() },
            { new: true }
        );

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        await ActivityLog.create({
            userId,
            companyId: company._id,
            action: 'DELETED_COMPANY',
            details: `Company ${company.name} deleted.`,
        });

        res.json({ success: true });
    } catch (error: any) {
        serverError(res, 'deleteCompany', error);
    }
};

// ─── Compliance summary ───────────────────────────────────────────────────────

// Parse fiscalYearEnd string ("December 31", "Dec 31", "12-31", etc.) → [month, day] 1-indexed
const parseFYE = (fye: string | undefined): [number, number] => {
    if (!fye) return [12, 31];
    const mmdd = fye.match(/^(\d{1,2})-(\d{1,2})$/);
    if (mmdd) return [parseInt(mmdd[1]), parseInt(mmdd[2])];
    const MONTHS: Record<string, number> = {
        january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
        july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
        jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const named = fye.toLowerCase().match(/([a-z]+)\s+(\d{1,2})/);
    if (named && MONTHS[named[1]]) return [MONTHS[named[1]], parseInt(named[2])];
    return [12, 31];
};

// Returns the list of fiscal years (by FYE year) for which an annual return is expected.
// A year is expected once its FYE date has passed (strictly before today).
const computeExpectedFiscalYears = (
    incorporationDate: Date | undefined,
    fiscalYearEnd: string | undefined,
    today: Date,
): number[] => {
    if (!incorporationDate) return [];
    const [mm, dd] = parseFYE(fiscalYearEnd);
    const incorpYear = incorporationDate.getFullYear();
    // First FYE strictly after the incorporation date
    let fye = new Date(incorpYear, mm - 1, dd);
    if (fye <= incorporationDate) {
        fye = new Date(incorpYear + 1, mm - 1, dd);
    }
    const years: number[] = [];
    while (fye < today) {
        years.push(fye.getFullYear());
        fye = new Date(fye.getFullYear() + 1, mm - 1, dd);
    }
    return years;
};

const RESOLUTION_ELIGIBLE = new Set([
    'director_appointed', 'director_resigned', 'director_address_changed',
    'officer_appointed', 'officer_resigned',
    'shares_issued', 'shares_transferred', 'shares_cancelled', 'share_class_added',
    'address_changed', 'name_changed', 'fiscal_year_end_changed',
]);

const REGISTRY_REQUIRED = new Set([
    'director_appointed', 'director_resigned', 'director_address_changed',
    'address_changed', 'name_changed', 'shares_transferred', 'shares_issued',
    'shares_cancelled', 'share_class_added',
]);

export const getComplianceSummary = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const companies = await Company.find({ userId, ...ACTIVE }).lean();
        if (companies.length === 0) return res.json([]);

        const companyIds = companies.map((c) => c._id);
        const events = await CorporateEvent.find({ companyId: { $in: companyIds }, deletedAt: null }).lean();

        // Group events by company
        const byCompany: Record<string, typeof events> = {};
        for (const ev of events) {
            const cid = ev.companyId.toString();
            if (!byCompany[cid]) byCompany[cid] = [];
            byCompany[cid].push(ev);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const summary = companies.map((company) => {
            const cid = (company._id as any).toString();
            const compEvents = byCompany[cid] || [];

            const missingResolutions = compEvents.filter(
                (e) =>
                    RESOLUTION_ELIGIBLE.has(e.eventType) &&
                    !(e.attachments || []).some((a: any) => a.role === 'resolution'),
            ).length;

            const missingRegistryFilings = compEvents.filter(
                (e) =>
                    REGISTRY_REQUIRED.has(e.eventType) &&
                    !(e.attachments || []).some((a: any) => a.role === 'registry_filing') &&
                    !(e as any).registryFilingNotApplicable,
            ).length;

            let annualReturnStatus: 'not_set' | 'ok' | 'due_soon' | 'overdue' = 'not_set';
            let daysUntilAnnualReturn: number | null = null;

            const dueMMDD = (company as any).annualReturnDueDate as string | undefined;
            if (dueMMDD) {
                const [mm, dd] = dueMMDD.split('-').map(Number);

                const thisYearDue = new Date(today.getFullYear(), mm - 1, dd);
                const prevDue = thisYearDue >= today
                    ? new Date(today.getFullYear() - 1, mm - 1, dd)
                    : thisYearDue;
                const nextDue = thisYearDue >= today ? thisYearDue : new Date(today.getFullYear() + 1, mm - 1, dd);

                daysUntilAnnualReturn = Math.ceil((nextDue.getTime() - today.getTime()) / 86400000);

                const lastFiled = compEvents
                    .filter((e) => e.eventType === 'annual_return_filed')
                    .map((e) => new Date(e.effectiveDate))
                    .sort((a, b) => b.getTime() - a.getTime())[0];

                const filedThisPeriod = lastFiled && lastFiled >= prevDue;

                if (today > prevDue && !filedThisPeriod) {
                    annualReturnStatus = 'overdue';
                } else if (daysUntilAnnualReturn <= 30 && !filedThisPeriod) {
                    annualReturnStatus = 'due_soon';
                } else {
                    annualReturnStatus = 'ok';
                }
            }

            // Document-level expectations
            const missingIncorpDoc = !(company as any).incorporationDocumentFile;

            const incorpDate = (company as any).incorporationDate
                ? new Date((company as any).incorporationDate)
                : undefined;
            const expectedYears = computeExpectedFiscalYears(incorpDate, (company as any).fiscalYearEnd, today);

            const filedYearSet = new Set(
                compEvents
                    .filter((e) => e.eventType === 'annual_return_filed' && (e.data as any)?.year != null)
                    .map((e) => Number((e.data as any).year))
                    .filter((y) => !isNaN(y)),
            );
            const missingAnnualReturnYears = expectedYears.filter((y) => !filedYearSet.has(y));
            const filedAnnualReturns = compEvents.filter((e) => e.eventType === 'annual_return_filed').length;

            const issues = missingResolutions + missingRegistryFilings
                + (missingIncorpDoc ? 1 : 0)
                + missingAnnualReturnYears.length;

            // Registry-drift state — surfaced to the dashboard banner. The
            // scheduled poller flips `drift.detectedAt` when the government
            // registry snapshot no longer matches this record.
            const drift = (company as any).drift;
            const driftDetected = !!(drift?.detectedAt && !drift?.resolvedAt);

            return {
                companyId: cid,
                issues,
                missingResolutions,
                missingRegistryFilings,
                annualReturnStatus,
                daysUntilAnnualReturn,
                missingIncorpDoc,
                expectedAnnualReturns: expectedYears.length,
                filedAnnualReturns,
                missingAnnualReturnYears,
                driftDetected,
                driftFields: driftDetected ? (drift?.fields ?? []) : [],
            };
        });

        return res.json(summary);
    } catch (error: any) {
        return serverError(res, 'getComplianceSummary', error);
    }
};

/**
 * GET /api/companies/upsell-candidates
 *
 * Returns crs_seeded companies that have enough CRS-fed filings on record
 * to justify prompting the user to build a complete minute book. Used by
 * the dashboard to render a per-company banner: "You have N filings on
 * record for ACME INC. — build your minute book."
 *
 * A company is eligible when:
 *   - it's owned by the requesting user
 *   - origin === 'crs_seeded'
 *   - it has at least 2 CorporateEvent rows
 */
const UPSELL_EVENT_THRESHOLD = 2;

export const getUpsellCandidates = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const seeded = await Company.find({ userId, origin: 'crs_seeded', ...ACTIVE }).lean();
        if (seeded.length === 0) return res.json([]);

        const companyIds = seeded.map((c) => c._id);
        const counts = await CorporateEvent.aggregate([
            { $match: { companyId: { $in: companyIds }, deletedAt: null } },
            { $group: { _id: '$companyId', count: { $sum: 1 } } },
        ]);
        const countByCompany: Record<string, number> = {};
        for (const row of counts) countByCompany[String(row._id)] = row.count;

        const candidates = seeded
            .map((c) => ({
                companyId:   c._id,
                name:        c.name,
                jurisdiction: c.registeredOfficeAddress?.province ?? '',
                eventCount:  countByCompany[String(c._id)] ?? 0,
                claimedAt:   c.claimedAt,
            }))
            .filter((c) => c.eventCount >= UPSELL_EVENT_THRESHOLD);

        return res.json(candidates);
    } catch (error: any) {
        return serverError(res, 'getUpsellCandidates', error);
    }
};

/**
 * POST /api/companies/:id/resolve-drift
 *
 * User action: "I've reconciled the drift with the government registry
 * (updated the internal record, or confirmed the registry state)." Clears
 * the drift flag so the dashboard banner disappears until the next weekly
 * scan re-detects a divergence.
 */
export const resolveDrift = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const id = String(req.params.id);
        const company = await Company.findOne({ _id: id, userId, deletedAt: null });
        if (!company) return res.status(404).json({ error: 'Company not found.' });

        (company as any).drift = {
            ...(company as any).drift,
            detectedAt: null,
            fields:     [],
            resolvedAt: new Date(),
        };
        await company.save();

        await ActivityLog.create({
            userId,
            companyId: id,
            action:    'UPDATED_COMPANY',
            details:   `Registry drift acknowledged for ${company.name}.`,
        });

        return res.json({ ok: true });
    } catch (error: any) {
        return serverError(res, 'resolveDrift', error);
    }
};

