import express from 'express';
import { parseIncorporationDocument, serveIncorporationDocument, uploadMiddleware } from '../controllers/incorporationController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/parse', protect, uploadMiddleware, parseIncorporationDocument);
router.get('/file/:filename', protect, serveIncorporationDocument);

export default router;
