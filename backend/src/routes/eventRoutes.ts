import express from 'express';
import {
    createEvent,
    getEvents,
    attachEvent,
    serveAttachment,
    generateResolution,
    sendResolution,
    sendForESign,
    getESignStatus,
    getBuilderToken,
    recordESignResult,
    eventAttachMiddleware,
} from '../controllers/eventController';
import { protect } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validate';
import { createEventSchema } from '../schemas/event.schema';

const router = express.Router();

router.post('/', protect, validateBody(createEventSchema), createEvent);
router.get('/:companyId', protect, getEvents);
router.post('/:id/attach', protect, eventAttachMiddleware, attachEvent);
router.get('/:id/attachment/:fileId', protect, serveAttachment);
router.get('/:id/resolution', protect, generateResolution);
router.post('/:id/send-resolution', protect, sendResolution);
router.post('/:id/esign', protect, sendForESign);
router.get('/:id/esign/status', protect, getESignStatus);
router.post('/:id/esign/builder-token', protect, getBuilderToken);
router.post('/:id/esign/record', protect, recordESignResult);

export default router;
