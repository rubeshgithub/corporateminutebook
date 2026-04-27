import express from 'express';
import { getStats } from '../controllers/statsController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.get('/', protect, getStats);

export default router;
