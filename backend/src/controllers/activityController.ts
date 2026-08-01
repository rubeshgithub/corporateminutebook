import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { ActivityLog } from '../models/ActivityLog';
import { serverError } from '../utils/apiError';

export const getActivity = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const logs = await ActivityLog.find({ userId })
            .sort({ timestamp: -1 })
            .limit(limit);
        res.json(logs);
    } catch (error: any) {
        serverError(res, 'getActivity', error);
    }
};
