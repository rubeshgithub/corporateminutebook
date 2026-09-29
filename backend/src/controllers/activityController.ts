import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { ActivityLog } from '../models/ActivityLog';
import { Company } from '../models/Company';
import { serverError } from '../utils/apiError';
import { workspaceFor } from '../utils/workspace';

export const getActivity = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const { ws } = await workspaceFor(req);

        // Own activity, plus everything colleagues did on the firm's companies
        // (deleted ones included, so "deleted X" entries stay in the feed).
        let filter: Record<string, unknown> = { userId };
        if (ws.organizationId) {
            const firmCompanyIds = await Company.find({ organizationId: ws.organizationId }).distinct('_id');
            filter = { $or: [{ userId }, { companyId: { $in: firmCompanyIds } }] };
        }

        const logs = await ActivityLog.find(filter)
            .sort({ timestamp: -1 })
            .limit(limit);
        res.json(logs);
    } catch (error: any) {
        serverError(res, 'getActivity', error);
    }
};
