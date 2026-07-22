import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    createShare, listShares, revokeShare,
    resolveShareEndpoint, shareMinuteBookEndpoint,
} from '../controllers/shareController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

/**
 * Owner-facing management endpoints live under /api/companies for
 * discoverability alongside the other company routes, but they're
 * wired through this router so the file structure mirrors the concern.
 * Public token endpoints live at /api/share/:token — cleaner URL for
 * anyone sharing the link.
 */

// Public resolve endpoints — NO auth. Cap per-IP so scanners can't burn
// through them and the minute-book generation stays throttled.
const publicShareLimiter = rateLimit({
    windowMs: 60 * 1000,
    max:      60,
    standardHeaders: true,
    legacyHeaders:   false,
    message: { error: 'Too many share-link accesses. Try again shortly.' },
});
const shareCompileLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max:      10,
    standardHeaders: true,
    legacyHeaders:   false,
    message: { error: 'Too many minute-book downloads on this share. Try again shortly.' },
});

router.get('/share/:token',              publicShareLimiter, resolveShareEndpoint);
router.get('/share/:token/minute-book',  shareCompileLimiter, shareMinuteBookEndpoint);

// Owner endpoints (auth).
router.post('/companies/:id/shares', protect, createShare);
router.get('/companies/:id/shares',  protect, listShares);
router.delete('/shares/:shareId',    protect, revokeShare);

export default router;
