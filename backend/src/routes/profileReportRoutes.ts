import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import {
    profileReportUpload, previewProfileReport, importProfileReport, serveProfileReport,
} from '../controllers/profileReportController';
import { protect } from '../middleware/authMiddleware';
import { validateParams } from '../middleware/validate';
import { companyIdParam } from '../schemas/approval.schema';

const router = express.Router();

// Reading a report can call the AI fallback, which costs money per call.
const readLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many report uploads. Try again in a few minutes.' },
});

/** Turns a multer rejection (wrong type, too large) into a readable 400. */
const withUpload = (req: Request, res: Response, next: NextFunction) =>
    profileReportUpload(req, res, (err: unknown) => {
        if (err) return res.status(400).json({ error: (err as Error).message || 'Upload failed.' });
        return next();
    });

router.post('/preview', protect, readLimiter, withUpload, previewProfileReport);
router.post('/import', protect, readLimiter, withUpload, importProfileReport);
router.get('/:id', protect, validateParams(companyIdParam), serveProfileReport);

export default router;
