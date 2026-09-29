import express from 'express';
import {
    getOrganization, createOrganization, renameOrganization,
    createInvite, revokeInvite, acceptInvite, declineInvite,
    updateMemberRole, removeMember,
} from '../controllers/organizationController';
import { protect } from '../middleware/authMiddleware';
import { validateBody, validateParams } from '../middleware/validate';
import {
    createOrganizationSchema, renameOrganizationSchema, createInviteSchema,
    updateMemberRoleSchema, userIdParam, inviteIdParam, organizationIdParam,
} from '../schemas/organization.schema';

const router = express.Router();

router.get('/', protect, getOrganization);
router.post('/', protect, validateBody(createOrganizationSchema), createOrganization);
router.patch('/', protect, validateBody(renameOrganizationSchema), renameOrganization);

router.post('/invites', protect, validateBody(createInviteSchema), createInvite);
router.delete('/invites/:inviteId', protect, validateParams(inviteIdParam), revokeInvite);
router.post('/invites/:organizationId/accept', protect, validateParams(organizationIdParam), acceptInvite);
router.post('/invites/:organizationId/decline', protect, validateParams(organizationIdParam), declineInvite);

router.patch('/members/:userId', protect, validateParams(userIdParam), validateBody(updateMemberRoleSchema), updateMemberRole);
router.delete('/members/:userId', protect, validateParams(userIdParam), removeMember);

export default router;
