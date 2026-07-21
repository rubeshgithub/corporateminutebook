import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { DocumentModel } from '../models/Document';
import { ActivityLog } from '../models/ActivityLog';
import { Company } from '../models/Company';
import { CorporateEvent } from '../models/CorporateEvent';
import { generatePDFBuffer, generateMinuteBookPDF, generateInauguralPackagePDF } from '../services/documentGenerator';

const TEMPLATE_LABELS: Record<string, string> = {
    glossary: 'Glossary',
    articles_of_incorporation: 'Articles of Incorporation',
    schedule_a: 'Schedule A — Share Capital',
    by_laws: 'By-Laws No. 1',
    organizational_resolution: 'Organizational Resolution (Directors)',
    shareholders_organizational_resolution: 'Organizational Resolution (Shareholders)',
    consent_to_act: 'Consent to Act as Director',
    annual_director_resolution: 'Annual Director Resolution',
    annual_shareholder_resolution: 'Annual Shareholder Resolution',
    share_subscription: 'Share Subscriptions',
    share_certificate: 'Share Certificate',
    share_ledger: 'Share Ledgers',
    share_transfer_register: 'Share Transfer Register',
    registers: 'Corporate Registers',
};

// Templates that need corporate event history to render accurately
const HISTORY_TEMPLATES = new Set(['share_ledger', 'share_transfer_register', 'registers', 'minute_book']);

const fetchEvents = async (companyId: string) =>
    CorporateEvent.find({ companyId, deletedAt: null }).sort({ effectiveDate: 1, recordedAt: 1 }).lean();

// ─── Compliance helpers (used for minute book gate) ──────────────────────────

const COMPILE_RESOLUTION_ELIGIBLE = new Set([
    'director_appointed', 'director_resigned', 'director_address_changed',
    'officer_appointed', 'officer_resigned',
    'shares_issued', 'shares_transferred', 'shares_cancelled', 'share_class_added',
    'address_changed', 'name_changed', 'fiscal_year_end_changed',
]);

const COMPILE_REGISTRY_REQUIRED = new Set([
    'director_appointed', 'director_resigned', 'director_address_changed',
    'address_changed', 'name_changed', 'shares_transferred', 'shares_issued',
    'shares_cancelled', 'share_class_added',
]);

const parseFYELocal = (fye: string | undefined): [number, number] => {
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

const computeExpectedYearsLocal = (
    incorporationDate: Date | undefined,
    fiscalYearEnd: string | undefined,
    today: Date,
): number[] => {
    if (!incorporationDate) return [];
    const [mm, dd] = parseFYELocal(fiscalYearEnd);
    const incorpYear = incorporationDate.getFullYear();
    let fye = new Date(incorpYear, mm - 1, dd);
    if (fye <= incorporationDate) fye = new Date(incorpYear + 1, mm - 1, dd);
    const years: number[] = [];
    while (fye < today) {
        years.push(fye.getFullYear());
        fye = new Date(fye.getFullYear() + 1, mm - 1, dd);
    }
    return years;
};

const buildComplianceGaps = (company: any, events: any[]): string[] => {
    const gaps: string[] = [];

    const missingRes = events.filter((e) =>
        COMPILE_RESOLUTION_ELIGIBLE.has(e.eventType) &&
        !(e.attachments || []).some((a: any) => a.role === 'resolution'),
    ).length;

    const missingReg = events.filter((e) =>
        COMPILE_REGISTRY_REQUIRED.has(e.eventType) &&
        !(e.attachments || []).some((a: any) => a.role === 'registry_filing'),
    ).length;

    if (!company.incorporationDocumentFile) {
        gaps.push('Certificate of Incorporation not uploaded');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const incorpDate = company.incorporationDate ? new Date(company.incorporationDate) : undefined;
    const expectedYears = computeExpectedYearsLocal(incorpDate, company.fiscalYearEnd, today);
    const filedYears = new Set(
        events
            .filter((e) => e.eventType === 'annual_return_filed' && e.data?.year != null)
            .map((e) => Number(e.data.year))
            .filter((y) => !isNaN(y)),
    );
    const missingARYears = expectedYears.filter((y) => !filedYears.has(y));

    if (missingARYears.length > 0) {
        gaps.push(`Annual returns not filed for FY ${missingARYears.join(', ')}`);
    }
    if (missingRes > 0) {
        gaps.push(`${missingRes} corporate change event${missingRes !== 1 ? 's' : ''} missing a signed resolution`);
    }
    if (missingReg > 0) {
        gaps.push(`${missingReg} corporate change event${missingReg !== 1 ? 's' : ''} missing a registry filing confirmation`);
    }

    return gaps;
};

export const generateDocument = async (req: AuthRequest, res: Response) => {
    try {
        const { companyId, documentType } = req.body;
        const userId = req.user?.id;

        const company = await Company.findOne({ _id: companyId, userId, deletedAt: null });
        if (!company) return res.status(404).json({ message: 'Company not found' });

        if (!TEMPLATE_LABELS[documentType]) {
            return res.status(400).json({
                message: 'Invalid document type. Valid templates are: ' + Object.keys(TEMPLATE_LABELS).join(', '),
            });
        }

        const events = HISTORY_TEMPLATES.has(documentType) ? await fetchEvents(companyId) : [];
        const extraData = req.body.resolutionData ? { resolution: req.body.resolutionData } : {};
        const pdfBuffer = await generatePDFBuffer(company, documentType, events, extraData);

        const previousCount = await DocumentModel.countDocuments({ companyId, type: documentType });
        await DocumentModel.create({
            companyId,
            title: TEMPLATE_LABELS[documentType],
            type: documentType,
            version: previousCount + 1,
            generatedAt: new Date(),
            generatedBy: userId,
        });

        await ActivityLog.create({
            userId,
            companyId,
            action: 'GENERATED_DOCUMENT',
            details: `Document ${documentType} generated for company ${company.name}.`,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${company.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${documentType}.pdf`);
        return res.send(pdfBuffer);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

export const getDocuments = async (req: AuthRequest, res: Response) => {
    try {
        const { companyId } = req.params;
        const userId = req.user?.id;

        const company = await Company.findOne({ _id: companyId, userId, deletedAt: null });
        if (!company) return res.status(404).json({ message: 'Company not found' });

        const documents = await DocumentModel.find({ companyId })
            .sort({ generatedAt: -1 })
            .populate('generatedBy', 'name email');
        return res.json(documents);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

export const compileMinuteBook = async (req: AuthRequest, res: Response) => {
    try {
        const { companyId, force } = req.body;
        const userId = req.user?.id;

        const company = await Company.findOne({ _id: companyId, userId, deletedAt: null });
        if (!company) return res.status(404).json({ message: 'Company not found' });

        const events = await fetchEvents(companyId);

        if (!force) {
            const gaps = buildComplianceGaps(company, events);
            if (gaps.length > 0) {
                return res.status(409).json({ status: 'compliance_warning', gaps });
            }
        }

        const pdfBuffer = await generateMinuteBookPDF(company, events);

        const previousCount = await DocumentModel.countDocuments({ companyId, type: 'minute_book' });
        await DocumentModel.create({
            companyId,
            title: 'Compiled Minute Book',
            type: 'minute_book',
            version: previousCount + 1,
            generatedAt: new Date(),
            generatedBy: userId,
        });

        await ActivityLog.create({
            userId,
            companyId,
            action: 'COMPILED_MINUTE_BOOK',
            details: `Compiled Minute Book generated for ${company.name}.`,
        });

        const safeName = company.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${safeName}_minute_book.pdf`);
        return res.send(pdfBuffer);
    } catch (error: any) {
        console.error('Failed to compile minute book:', error);
        return res.status(500).json({ error: error.message });
    }
};

export const generateInauguralPackage = async (req: AuthRequest, res: Response) => {
    try {
        const { companyId } = req.body;
        const userId = req.user?.id;

        const company = await Company.findOne({ _id: companyId, userId, deletedAt: null });
        if (!company) return res.status(404).json({ message: 'Company not found' });

        const events = await fetchEvents(companyId);
        const pdfBuffer = await generateInauguralPackagePDF(company, events);

        const previousCount = await DocumentModel.countDocuments({ companyId, type: 'inaugural_package' });
        await DocumentModel.create({
            companyId,
            title: 'Inaugural Package',
            type: 'inaugural_package',
            version: previousCount + 1,
            generatedAt: new Date(),
            generatedBy: userId,
        });

        await ActivityLog.create({
            userId,
            companyId,
            action: 'GENERATED_DOCUMENT',
            details: `Inaugural Package generated for ${company.name}.`,
        });

        const safeName = company.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${safeName}_inaugural_package.pdf`);
        return res.send(pdfBuffer);
    } catch (error: any) {
        console.error('Failed to generate inaugural package:', error);
        return res.status(500).json({ error: error.message });
    }
};
