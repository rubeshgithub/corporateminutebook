import express from 'express';
import rateLimit from 'express-rate-limit';
import { generateDocument, getDocuments, compileMinuteBook, generateInauguralPackage, generateBundle } from '../controllers/documentController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

/**
 * PDF generation is the heaviest work in the app — each call spins up a
 * Puppeteer page and can render a 30+ page document. Cap it per IP so a
 * single user (or attacker) can't OOM the dyno by looping compile calls.
 */
const generationLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many generations. Please wait a minute.' },
});

/** Full minute-book / inaugural compile is the heaviest of all — cap tighter. */
const compileLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many minute-book compiles. Please wait 5 minutes.' },
});

router.post('/generate', protect, generationLimiter, generateDocument);
router.post('/compile', protect, compileLimiter, compileMinuteBook);
router.post('/inaugural', protect, compileLimiter, generateInauguralPackage);
// Purpose-driven bundles (bank / dd / cra) share the compile pipeline —
// same rate cap because they're the same underlying render cost.
router.post('/bundle/:bundleType', protect, compileLimiter, generateBundle);
router.get('/:companyId', protect, getDocuments);

export default router;
