import express from 'express';
import { getActivity } from '../controllers/activityController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.get('/', protect, getActivity);

export default router;
