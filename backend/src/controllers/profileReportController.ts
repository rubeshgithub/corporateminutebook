import { Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../middleware/authMiddleware';
import { Company } from '../models/Company';
import { CorporateEvent } from '../models/CorporateEvent';
import { ActivityLog } from '../models/ActivityLog';
import { User } from '../models/User';
import { putFile, getFile } from '../services/uploadStorage';
import { serverError } from '../utils/apiError';
import { workspaceFor } from '../utils/workspace';
import { readProfileReport, buildImportPlan, hasBlocker } from '../services/profileReports';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('Only PDF files are accepted.'));
    },
});

export const profileReportUpload = upload.single('report');

const UNRECOGNISED =
    'This doesn\'t look like a registry profile report we can read. Upload the current profile / search report from ' +
    'Alberta, British Columbia, Ontario, Saskatchewan or Corporations Canada.';

const readAndPlan = async (req: AuthRequest) => {
    const { report, unreadPages } = await readProfileReport(req.file!.buffer);
    if (!report) return null;
    return { report, plan: buildImportPlan(report, new Date(), { unreadPages }) };
};

/**
 * POST /api/profile-reports/preview — read the report and show what the
 * import would create, without creating anything.
 */
export const previewProfileReport = async (req: AuthRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'Upload the profile report as a PDF.' });
    try {
        const result = await readAndPlan(req);
        if (!result) return res.status(422).json({ error: UNRECOGNISED });

        const { scope } = await workspaceFor(req);
        const existing = await Company.findOne({
            ...scope, corporateAccessNumber: result.report.corporation.number, deletedAt: null,
        }).select('_id name').lean();

        return res.json({ ...result, existingCompany: existing ?? null });
    } catch (error: any) {
        return serverError(res, 'previewProfileReport', error);
    }
};

/**
 * POST /api/profile-reports/import — re-reads the uploaded report (the
 * report, not the client, is the source of truth), then creates the company,
 * its dated history, and keeps the report PDF with it.
 */
export const importProfileReport = async (req: AuthRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'Upload the profile report as a PDF.' });
    try {
        const userId = req.user!.id;
        const result = await readAndPlan(req);
        if (!result) return res.status(422).json({ error: UNRECOGNISED });
        const { report, plan } = result;

        if (hasBlocker(plan)) {
            return res.status(422).json({ error: plan.flags.find((f) => f.level === 'blocker')!.message, flags: plan.flags });
        }
        if (plan.flags.some((f) => f.code === 'stale_report') && req.body.acknowledgeStale !== 'true') {
            return res.status(409).json({ error: 'This report is more than 30 days old. Confirm you want to continue with it.', code: 'stale_report' });
        }

        const { ws, scope } = await workspaceFor(req);
        const duplicate = await Company.findOne({ ...scope, corporateAccessNumber: report.corporation.number, deletedAt: null }).select('_id').lean();
        if (duplicate) {
            return res.status(409).json({ error: `${report.corporation.name} is already in your minute books.`, companyId: duplicate._id });
        }

        let organizationId: string | null = null;
        if (req.body.workspace === 'firm') {
            if (!ws.organizationId) return res.status(400).json({ error: 'You are not in a firm, so this company can only be personal.' });
            organizationId = ws.organizationId;
        }

        const fileId = `${uuidv4()}.pdf`;
        await putFile(fileId, req.file.buffer, 'application/pdf');

        // The person setting the book up; the editor requires it.
        const importer = await User.findById(userId).select('name email').lean();

        const company = await Company.create({
            ...plan.company,
            userId,
            organizationId,
            ...(importer?.email ? { authorizedBy: { name: importer.name || importer.email, email: importer.email } } : {}),
            origin: 'user_created',
            approval: { status: 'draft' },
            profileReport: {
                fileId,
                registry: report.registry,
                reportDate: report.reportDate ? new Date(report.reportDate) : null,
                importedAt: new Date(),
                source: report.source,
            },
        });

        if (plan.events.length) {
            await CorporateEvent.insertMany(plan.events.map((e) => ({
                companyId: company._id,
                userId,
                eventType: e.eventType,
                effectiveDate: new Date(e.effectiveDate),
                data: e.data,
                notes: e.notes,
                registryFilingNotApplicable: e.registryFilingNotApplicable,
            })));
        }

        await ActivityLog.create({
            userId,
            companyId: company._id,
            action: 'CREATED_COMPANY',
            details: `Company ${company.name} imported from its ${report.registryName} profile report (${plan.events.length} records).`,
        });

        return res.status(201).json({ companyId: company._id, flags: plan.flags });
    } catch (error: any) {
        return serverError(res, 'importProfileReport', error);
    }
};

/** GET /api/profile-reports/:id — the stored report PDF for a company the caller can open. */
export const serveProfileReport = async (req: AuthRequest, res: Response) => {
    try {
        const { scope } = await workspaceFor(req);
        const company = await Company.findOne({ _id: (req as any).validatedParams.id, ...scope, deletedAt: null })
            .select('profileReport name').lean();
        const fileId = company?.profileReport?.fileId;
        if (!fileId) return res.status(404).json({ error: 'No profile report on file.' });
        const bytes = await getFile(fileId);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="profile-report.pdf"');
        return res.send(bytes);
    } catch (error: any) {
        return serverError(res, 'serveProfileReport', error);
    }
};
