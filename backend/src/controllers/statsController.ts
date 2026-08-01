import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { Company } from '../models/Company';
import { DocumentModel } from '../models/Document';
import { ActivityLog } from '../models/ActivityLog';
import { serverError } from '../utils/apiError';

export const getStats = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;

        const companies = await Company.find({ userId, deletedAt: null });
        const companyIds = companies.map((c) => c._id);

        const [documentsCount, weekActivityCount] = await Promise.all([
            DocumentModel.countDocuments({ companyId: { $in: companyIds } }),
            ActivityLog.countDocuments({
                userId,
                timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            }),
        ]);

        let totalDirectors = 0;
        let totalShareholders = 0;
        let totalShares = 0;
        companies.forEach((c: any) => {
            totalDirectors += c.directors?.length || 0;
            totalShareholders += c.shareholders?.length || 0;
            (c.shareholders || []).forEach((s: any) => { totalShares += s.numberOfShares || 0; });
        });

        res.json({
            companies: companies.length,
            documents: documentsCount,
            directors: totalDirectors,
            shareholders: totalShareholders,
            sharesIssued: totalShares,
            activityLast7Days: weekActivityCount,
        });
    } catch (error: any) {
        serverError(res, 'getStats', error);
    }
};
