import type { AuthRequest } from '../middleware/authMiddleware';
import { User } from '../models/User';
import type { FirmRole } from '../models/Organization';

export interface Workspace {
    userId: string;
    organizationId: string | null;
    organizationRole: FirmRole | null;
}

interface CompanyOwnership {
    userId: unknown;
    organizationId?: unknown;
}

/**
 * The caller's firm membership, read from the database on every request
 * rather than carried in the JWT: removing someone from a firm must cut off
 * access immediately, not when their 30-day token happens to expire.
 */
export const loadWorkspace = async (userId: string): Promise<Workspace> => {
    const user = await User.findById(userId).select('organizationId organizationRole').lean();
    const organizationId = user?.organizationId ? String(user.organizationId) : null;
    return {
        userId,
        organizationId,
        organizationRole: organizationId ? ((user?.organizationRole as FirmRole) || 'member') : null,
    };
};

/**
 * Mongo filter for every company this workspace may open: the caller's own
 * personal companies, plus all of their firm's companies. `organizationId:
 * null` also matches records created before the field existed.
 */
export const companyScope = (ws: Workspace): Record<string, unknown> => {
    if (!ws.userId) {
        // Mongoose drops undefined keys from filters, so a missing userId would
        // silently widen the scope to every tenant. Fail closed instead.
        throw new Error('companyScope requires a userId.');
    }
    const personal = { userId: ws.userId, organizationId: null };
    return ws.organizationId
        ? { $or: [personal, { organizationId: ws.organizationId }] }
        : personal;
};

/** The workspace and company filter for an authenticated request. */
export const workspaceFor = async (req: AuthRequest): Promise<{ ws: Workspace; scope: Record<string, unknown> }> => {
    const userId = req.user?.id;
    if (!userId) throw new Error('workspaceFor called without an authenticated user.');
    const ws = await loadWorkspace(userId);
    return { ws, scope: companyScope(ws) };
};

export const isFirmCompany = (company: CompanyOwnership): boolean => !!company.organizationId;

/**
 * Only a supervisor may delete a firm company — a legal assistant can build
 * and edit a client's records but cannot destroy them. A personal company
 * can be deleted by the person who created it.
 */
export const canDeleteCompany = (ws: Workspace, company: CompanyOwnership): boolean => {
    if (isFirmCompany(company)) {
        return String(company.organizationId) === ws.organizationId && ws.organizationRole === 'supervisor';
    }
    return String(company.userId) === ws.userId;
};

/** A personal company can be handed over to the creator's firm. */
export const canMoveToFirm = (ws: Workspace, company: CompanyOwnership): boolean =>
    !!ws.organizationId && !isFirmCompany(company) && String(company.userId) === ws.userId;

/**
 * A firm must always keep at least one supervisor, or nobody could manage
 * members or approve its minute books. True when removing or demoting the
 * target would leave it with none.
 */
export const wouldRemoveLastSupervisor = (targetRole: FirmRole | null | undefined, supervisorCount: number): boolean =>
    targetRole === 'supervisor' && supervisorCount <= 1;
