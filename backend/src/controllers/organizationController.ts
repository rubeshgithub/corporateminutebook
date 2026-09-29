import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { Organization, type FirmRole } from '../models/Organization';
import { User } from '../models/User';
import { sendFirmInviteEmail } from '../services/emailService';
import { serverError } from '../utils/apiError';
import { loadWorkspace, wouldRemoveLastSupervisor } from '../utils/workspace';
import type { CreateInviteInput } from '../schemas/organization.schema';

const MAX_PENDING_INVITES = 100;

const LAST_SUPERVISOR_ERROR =
    'A firm needs at least one supervisor. Make another member a supervisor first.';

/** Invitations addressed to this email by any firm, for the "join a firm" prompt. */
const pendingInvitesFor = async (email: string) => {
    const orgs = await Organization.find({ 'invites.email': email }).select('name invites').lean();
    const inviterIds = orgs.flatMap((o) => o.invites.filter((i) => i.email === email).map((i) => i.invitedBy));
    const inviters = await User.find({ _id: { $in: inviterIds } }).select('name email').lean();
    const inviterName = (id: unknown) => {
        const u = inviters.find((x) => String(x._id) === String(id));
        return u?.name || u?.email || '';
    };
    return orgs.flatMap((o) =>
        o.invites
            .filter((i) => i.email === email)
            .map((i) => ({
                organizationId:   o._id,
                organizationName: o.name,
                role:             i.role,
                invitedAt:        i.invitedAt,
                invitedBy:        inviterName(i.invitedBy),
            })),
    );
};

const supervisorCount = (organizationId: string) =>
    User.countDocuments({ organizationId, organizationRole: 'supervisor' });

/**
 * GET /api/organization — the caller's firm (members, and pending invites if
 * they supervise) plus any invitations waiting for their own email address.
 */
export const getOrganization = async (req: AuthRequest, res: Response) => {
    try {
        const me = await User.findById(req.user!.id).select('email organizationId organizationRole').lean();
        if (!me) return res.status(404).json({ error: 'User not found.' });

        const pendingInvites = await pendingInvitesFor(me.email);
        const org = me.organizationId ? await Organization.findById(me.organizationId).lean() : null;
        if (!org) {
            return res.json({ organization: null, role: null, members: [], invites: [], pendingInvites });
        }

        const members = await User.find({ organizationId: org._id })
            .select('name email organizationRole organizationJoinedAt')
            .sort({ organizationJoinedAt: 1 })
            .lean();
        const isSupervisor = me.organizationRole === 'supervisor';

        return res.json({
            organization: { _id: org._id, name: org.name, type: org.type, createdAt: org.createdAt },
            role: me.organizationRole,
            members: members.map((m) => ({
                _id:      m._id,
                name:     m.name,
                email:    m.email,
                role:     m.organizationRole,
                joinedAt: m.organizationJoinedAt,
            })),
            // Only supervisors manage invitations; members don't see the list.
            invites: isSupervisor
                ? org.invites.map((i) => ({ _id: i._id, email: i.email, role: i.role, invitedAt: i.invitedAt }))
                : [],
            pendingInvites,
        });
    } catch (error: any) {
        return serverError(res, 'getOrganization', error);
    }
};

/** POST /api/organization — create a firm; the caller becomes its supervisor. */
export const createOrganization = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const ws = await loadWorkspace(userId);
        if (ws.organizationId) {
            return res.status(409).json({ error: 'You already belong to a firm. Leave it before creating a new one.' });
        }

        const org = await Organization.create({ name: req.body.name, createdBy: userId });
        // Conditional on still having no firm, so two racing requests can't
        // leave the user in one firm with an orphaned second one.
        const joined = await User.findOneAndUpdate(
            { _id: userId, organizationId: null },
            { $set: { organizationId: org._id, organizationRole: 'supervisor', organizationJoinedAt: new Date() } },
        );
        if (!joined) {
            await Organization.deleteOne({ _id: org._id });
            return res.status(409).json({ error: 'You already belong to a firm.' });
        }

        return res.status(201).json({ _id: org._id, name: org.name, type: org.type, role: 'supervisor' });
    } catch (error: any) {
        return serverError(res, 'createOrganization', error);
    }
};

/** PATCH /api/organization — rename the firm (supervisor only). */
export const renameOrganization = async (req: AuthRequest, res: Response) => {
    try {
        const ws = await loadWorkspace(req.user!.id);
        if (!ws.organizationId) return res.status(404).json({ error: 'You are not in a firm.' });
        if (ws.organizationRole !== 'supervisor') return res.status(403).json({ error: 'Only a supervisor can rename the firm.' });

        const org = await Organization.findByIdAndUpdate(ws.organizationId, { $set: { name: req.body.name } }, { new: true });
        if (!org) return res.status(404).json({ error: 'Firm not found.' });
        return res.json({ _id: org._id, name: org.name });
    } catch (error: any) {
        return serverError(res, 'renameOrganization', error);
    }
};

/** POST /api/organization/invites — invite someone by email (supervisor only). */
export const createInvite = async (req: AuthRequest, res: Response) => {
    try {
        const { email, role } = req.body as CreateInviteInput;
        const ws = await loadWorkspace(req.user!.id);
        if (!ws.organizationId) return res.status(404).json({ error: 'You are not in a firm.' });
        if (ws.organizationRole !== 'supervisor') return res.status(403).json({ error: 'Only a supervisor can invite members.' });

        const alreadyMember = await User.exists({ email, organizationId: ws.organizationId });
        if (alreadyMember) return res.status(409).json({ error: 'That person is already a member of this firm.' });

        const org = await Organization.findById(ws.organizationId);
        if (!org) return res.status(404).json({ error: 'Firm not found.' });

        // Re-inviting the same address updates the role and re-sends the email.
        const existing = org.invites.find((i) => i.email === email);
        if (existing) {
            existing.role = role;
            existing.invitedAt = new Date();
        } else {
            if (org.invites.length >= MAX_PENDING_INVITES) {
                return res.status(409).json({ error: 'Too many pending invitations. Revoke some before inviting more.' });
            }
            org.invites.push({ email, role, invitedBy: req.user!.id, invitedAt: new Date() } as any);
        }
        await org.save();
        const invite = org.invites.find((i) => i.email === email)!;

        let emailSent = true;
        try {
            const inviter = await User.findById(req.user!.id).select('name email').lean();
            await sendFirmInviteEmail({
                to: email,
                inviterName: inviter?.name || inviter?.email || 'A colleague',
                firmName: org.name,
                role,
            });
        } catch (err: any) {
            // The invitation stands without the email — the invitee still sees
            // it on the Firm page the next time they sign in.
            emailSent = false;
            console.error('[createInvite] invite email failed:', err?.message);
        }

        return res.status(existing ? 200 : 201).json({
            invite: { _id: invite._id, email: invite.email, role: invite.role, invitedAt: invite.invitedAt },
            emailSent,
        });
    } catch (error: any) {
        return serverError(res, 'createInvite', error);
    }
};

/** DELETE /api/organization/invites/:inviteId — revoke an invitation (supervisor only). */
export const revokeInvite = async (req: AuthRequest, res: Response) => {
    try {
        const { inviteId } = (req as any).validatedParams;
        const ws = await loadWorkspace(req.user!.id);
        if (!ws.organizationId) return res.status(404).json({ error: 'You are not in a firm.' });
        if (ws.organizationRole !== 'supervisor') return res.status(403).json({ error: 'Only a supervisor can revoke invitations.' });

        const result = await Organization.updateOne(
            { _id: ws.organizationId, 'invites._id': inviteId },
            { $pull: { invites: { _id: inviteId } } },
        );
        if (result.modifiedCount === 0) return res.status(404).json({ error: 'Invitation not found.' });
        return res.json({ ok: true });
    } catch (error: any) {
        return serverError(res, 'revokeInvite', error);
    }
};

/** POST /api/organization/invites/:organizationId/accept — join a firm that invited your email. */
export const acceptInvite = async (req: AuthRequest, res: Response) => {
    try {
        const { organizationId } = (req as any).validatedParams;
        const me = await User.findById(req.user!.id).select('email organizationId').lean();
        if (!me) return res.status(404).json({ error: 'User not found.' });
        if (me.organizationId) {
            return res.status(409).json({ error: 'You already belong to a firm. Leave it before joining another.' });
        }

        const org = await Organization.findOne({ _id: organizationId, 'invites.email': me.email });
        const invite = org?.invites.find((i) => i.email === me.email);
        if (!org || !invite) return res.status(404).json({ error: 'Invitation not found.' });

        const joined = await User.findOneAndUpdate(
            { _id: me._id, organizationId: null },
            { $set: { organizationId: org._id, organizationRole: invite.role as FirmRole, organizationJoinedAt: new Date() } },
        );
        if (!joined) return res.status(409).json({ error: 'You already belong to a firm.' });

        await Organization.updateOne({ _id: org._id }, { $pull: { invites: { email: me.email } } });
        return res.json({ organization: { _id: org._id, name: org.name }, role: invite.role });
    } catch (error: any) {
        return serverError(res, 'acceptInvite', error);
    }
};

/** POST /api/organization/invites/:organizationId/decline — dismiss an invitation to your email. */
export const declineInvite = async (req: AuthRequest, res: Response) => {
    try {
        const { organizationId } = (req as any).validatedParams;
        const me = await User.findById(req.user!.id).select('email').lean();
        if (!me) return res.status(404).json({ error: 'User not found.' });

        const result = await Organization.updateOne(
            { _id: organizationId, 'invites.email': me.email },
            { $pull: { invites: { email: me.email } } },
        );
        if (result.modifiedCount === 0) return res.status(404).json({ error: 'Invitation not found.' });
        return res.json({ ok: true });
    } catch (error: any) {
        return serverError(res, 'declineInvite', error);
    }
};

/** PATCH /api/organization/members/:userId — change a member's role (supervisor only). */
export const updateMemberRole = async (req: AuthRequest, res: Response) => {
    try {
        const { userId: targetId } = (req as any).validatedParams;
        const newRole = req.body.role as FirmRole;
        const ws = await loadWorkspace(req.user!.id);
        if (!ws.organizationId) return res.status(404).json({ error: 'You are not in a firm.' });
        if (ws.organizationRole !== 'supervisor') return res.status(403).json({ error: 'Only a supervisor can change roles.' });

        const target = await User.findOne({ _id: targetId, organizationId: ws.organizationId }).select('organizationRole');
        if (!target) return res.status(404).json({ error: 'Member not found.' });

        if (newRole === 'member' && wouldRemoveLastSupervisor(target.organizationRole, await supervisorCount(ws.organizationId))) {
            return res.status(409).json({ error: LAST_SUPERVISOR_ERROR });
        }

        target.organizationRole = newRole;
        await target.save();
        return res.json({ _id: target._id, role: newRole });
    } catch (error: any) {
        return serverError(res, 'updateMemberRole', error);
    }
};

/**
 * DELETE /api/organization/members/:userId — a supervisor removes a member,
 * or anyone passes their own id to leave. The firm's companies stay with the
 * firm; the departing person simply loses access to them.
 */
export const removeMember = async (req: AuthRequest, res: Response) => {
    try {
        const { userId: targetId } = (req as any).validatedParams;
        const ws = await loadWorkspace(req.user!.id);
        if (!ws.organizationId) return res.status(404).json({ error: 'You are not in a firm.' });

        const leaving = targetId === ws.userId;
        if (!leaving && ws.organizationRole !== 'supervisor') {
            return res.status(403).json({ error: 'Only a supervisor can remove members.' });
        }

        const target = await User.findOne({ _id: targetId, organizationId: ws.organizationId }).select('organizationRole');
        if (!target) return res.status(404).json({ error: 'Member not found.' });

        if (wouldRemoveLastSupervisor(target.organizationRole, await supervisorCount(ws.organizationId))) {
            return res.status(409).json({ error: LAST_SUPERVISOR_ERROR });
        }

        await User.updateOne(
            { _id: target._id },
            { $set: { organizationId: null, organizationRole: null, organizationJoinedAt: null } },
        );
        return res.json({ ok: true, left: leaving });
    } catch (error: any) {
        return serverError(res, 'removeMember', error);
    }
};
