import express from 'express';
import rateLimit from 'express-rate-limit';
import { parseIncorporationDocument, serveIncorporationDocument, uploadMiddleware } from '../controllers/incorporationController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

/**
 * /parse invokes Claude on a full PDF (an image-based scan can be 5+ MB
 * uploaded, tens of thousands of input tokens). This is the single most
 * expensive endpoint in the app on a per-call basis — cap tightly so a
 * looping bug in the client can't burn the LLM budget.
 */
const parseLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Incorporation-document parsing is limited to 20 uploads per hour.' },
});

router.post('/parse', protect, parseLimiter, uploadMiddleware, parseIncorporationDocument);
router.get('/file/:filename', protect, serveIncorporationDocument);

export default router;
