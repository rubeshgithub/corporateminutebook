import express from 'express';
import { generateDocument, getDocuments } from '../controllers/documentController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/generate', protect, generateDocument);
router.get('/:companyId', protect, getDocuments);

export default router;
