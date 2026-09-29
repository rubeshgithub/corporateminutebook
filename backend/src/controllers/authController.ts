import { Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { CorporateEvent } from '../models/CorporateEvent';
import { CompanyShare } from '../models/CompanyShare';
import { DocumentModel } from '../models/Document';
import { ActivityLog } from '../models/ActivityLog';
import { Organization } from '../models/Organization';
import { sendOtpEmail } from '../services/emailService';
import { deleteFile } from '../services/uploadStorage';
import { AuthRequest } from '../middleware/authMiddleware';
import { serverError } from '../utils/apiError';
import { DeleteAccountInput, UpdatePreferencesInput } from '../schemas/auth.schema';

const generateToken = (id: string, role: string) =>
    jwt.sign({ id, role }, process.env.JWT_SECRET as string, { expiresIn: '30d' });

/** The firm the SPA should render the shell for, or null for a solo account. */
const organizationSummary = async (user: { organizationId?: unknown; organizationRole?: string | null }) => {
    if (!user.organizationId) return null;
    const org = await Organization.findById(user.organizationId).select('name').lean();
    return org ? { _id: org._id, name: org.name, role: user.organizationRole ?? 'member' } : null;
};

const OTP_TTL_MINUTES = 10;
/** Wrong guesses allowed per issued code before it is burned. */
const OTP_MAX_ATTEMPTS = 5;
const OTP_BCRYPT_ROUNDS = 10;
const AUTH_COOKIE = 'mb_auth';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;   // matches the JWT expiry

/**
 * Cookie config. In production the SPA and API are on separate Render
 * domains, which is cross-origin — the cookie has to be sameSite: 'none'
 * with secure: true to be sent on those XHRs. In dev we run on
 * http://localhost, so sameSite: 'lax' + secure: false is the working
 * combo. NODE_ENV=production drives the switch.
 */
function setAuthCookie(res: Response, token: string) {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(AUTH_COOKIE, token, {
        httpOnly: true,
        secure:   isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge:   COOKIE_MAX_AGE_MS,
        path:     '/',
    });
}

function clearAuthCookie(res: Response) {
    const isProd = process.env.NODE_ENV === 'production';
    res.clearCookie(AUTH_COOKIE, {
        httpOnly: true,
        secure:   isProd,
        sameSite: isProd ? 'none' : 'lax',
        path:     '/',
    });
}

export const requestOtp = async (req: Request, res: Response) => {
    try {
        const email = (req.body.email as string)?.toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'Email is required' });

        // crypto.randomInt is a CSPRNG — Math.random() is seeded predictably
        // and its output can be reconstructed from observed values.
        const code = String(crypto.randomInt(100_000, 1_000_000));
        const expiry = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

        await User.findOneAndUpdate(
            { email },
            {
                $set: {
                    otpHash: await bcrypt.hash(code, OTP_BCRYPT_ROUNDS),
                    otpExpiry: expiry,
                    otpAttempts: 0,
                },
                $unset: { otpCode: '' },   // drop any legacy plaintext code
            },
            { upsert: true, new: true }
        );

        await sendOtpEmail({ to: email, code });

        res.json({ message: 'Code sent. Check your email.' });
    } catch (error: any) {
        serverError(res, 'requestOtp', error);
    }
};

export const verifyOtp = async (req: Request, res: Response) => {
    try {
        const email = (req.body.email as string)?.toLowerCase().trim();
        const code = (req.body.code as string)?.trim();

        if (!email || !code) {
            return res.status(400).json({ error: 'Email and code are required' });
        }

        const user = await User.findOne({ email });
        if (!user || !user.otpHash || !user.otpExpiry) {
            return res.status(401).json({ error: 'No code found. Request a new one.' });
        }

        if (new Date() > user.otpExpiry) {
            return res.status(401).json({ error: 'Code has expired. Request a new one.' });
        }

        // Burn the code once it has been guessed at too many times, so a
        // distributed attacker can't walk the 1M-code space with one code.
        if ((user.otpAttempts ?? 0) >= OTP_MAX_ATTEMPTS) {
            user.otpHash = undefined;
            user.otpExpiry = undefined;
            user.otpAttempts = 0;
            await user.save();
            return res.status(401).json({ error: 'Too many incorrect attempts. Request a new code.' });
        }

        // bcrypt.compare is constant-time for a given hash.
        if (!(await bcrypt.compare(code, user.otpHash))) {
            user.otpAttempts = (user.otpAttempts ?? 0) + 1;
            await user.save();
            return res.status(401).json({ error: 'Invalid code.' });
        }

        user.otpHash = undefined;
        user.otpExpiry = undefined;
        user.otpAttempts = 0;
        if (!user.name) user.name = email.split('@')[0];

        // First successful OTP verify is the "claim" moment for accounts that
        // were seeded from a paid CRS order. We stamp firstLoggedInAt on the
        // user and mark every crs_seeded company they own as claimed, so the
        // dashboard can distinguish "still an anonymous seed" from "the real
        // owner is now signed in."
        const isFirstLogin = user.origin === 'crs_seeded' && !user.firstLoggedInAt;
        if (isFirstLogin) {
            user.firstLoggedInAt = new Date();
            await Company.updateMany(
                { userId: user._id, origin: 'crs_seeded', claimedAt: null },
                { $set: { claimedAt: new Date() } },
            );
        }
        await user.save();

        // Token now rides in an httpOnly cookie — no longer returned in the
        // body. XSS in the SPA can't read it. The client keeps user metadata
        // in localStorage as a cache for UI; the cookie is the source of
        // truth, and any 401 bounces to login.
        setAuthCookie(res, generateToken(user._id.toString(), user.role));

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            organization: await organizationSummary(user),
            justClaimed: isFirstLogin,  // frontend uses this to show a welcome flash
        });
    } catch (error: any) {
        serverError(res, 'verifyOtp', error);
    }
};

export const logout = (_req: Request, res: Response) => {
    clearAuthCookie(res);
    res.json({ ok: true });
};

/**
 * POST /api/auth/test-mint-session — CI/persona-test session bypass.
 *
 * Guarded by BOTH:
 *   - TEST_MODE_ENABLED=true (env)
 *   - x-test-token header matching TEST_MODE_TOKEN (env)
 *
 * When either check fails we 404 (env off) or 401 (bad token), so a
 * production instance without the env vars is completely opaque to any
 * request that hits this endpoint. Existing users are reused when
 * present; otherwise a bare user is materialized so persona tests can
 * hit any email without pre-seeding.
 *
 * This is the only way the automated persona test suite can log in
 * without going through the OTP + SES round-trip.
 */
export const testMintSession = async (req: Request, res: Response) => {
    if (process.env.TEST_MODE_ENABLED !== 'true') {
        return res.status(404).json({ error: 'Not found.' });
    }
    const expectedToken = process.env.TEST_MODE_TOKEN;
    const providedToken = req.header('x-test-token');
    if (!expectedToken || providedToken !== expectedToken) {
        return res.status(401).json({ error: 'Invalid test token.' });
    }

    const email = String(req.body?.email ?? '').toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'A valid email is required.' });
    }

    let user = await User.findOne({ email });
    if (!user) {
        user = await User.create({
            email,
            name:             email.split('@')[0],
            role:             'business_owner',
            subscriptionTier: 'free',
        });
    }

    setAuthCookie(res, generateToken(user._id.toString(), user.role));
    return res.json({
        _id:   user._id,
        name:  user.name,
        email: user.email,
        role:  user.role,
        organization: await organizationSummary(user),
        testSession: true,
    });
};

/**
 * Returns the current user's public profile — used by the SPA on boot to
 * decide whether the cached user in localStorage is still logged in
 * server-side. If the cookie is missing/expired, `protect` returns 401
 * and the frontend clears its cache.
 */
export const me = async (req: AuthRequest, res: Response) => {
    try {
        const user = await User.findById(req.user!.id).select('_id name email role reminderOptOut createdAt organizationId organizationRole');
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json({
            _id:            user._id,
            name:           user.name,
            email:          user.email,
            role:           user.role,
            reminderOptOut: !!user.reminderOptOut,
            createdAt:      user.createdAt,
            organization:   await organizationSummary(user),
        });
    } catch (error: any) {
        serverError(res, 'me', error);
    }
};

/**
 * PATCH /api/auth/preferences — in-app counterpart to the emailed CASL
 * unsubscribe link. Unlike the link, this can also turn reminders back on.
 * Body is validated by updatePreferencesSchema.
 */
export const updatePreferences = async (req: AuthRequest, res: Response) => {
    try {
        const { reminderOptOut } = req.body as UpdatePreferencesInput;
        const user = await User.findByIdAndUpdate(
            req.user!.id,
            { $set: { reminderOptOut, reminderOptOutAt: reminderOptOut ? new Date() : null } },
            { new: true },
        ).select('reminderOptOut');
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json({ reminderOptOut: !!user.reminderOptOut });
    } catch (error: any) {
        serverError(res, 'updatePreferences', error);
    }
};

/**
 * DELETE /api/auth/account — self-service, permanent account deletion.
 *
 * The privacy policy promises users can delete their account and its
 * contents; this is that promise. Everything the user owns goes: every
 * company (soft-deleted ones included — a hidden flag is not erasure),
 * every recorded event, uploaded attachment, generated-document record,
 * share link, activity-log row, and finally the user itself.
 *
 * Ordering is deliberate. Stored files go first, then the rows that point
 * at them, and the User row last: if any step fails part-way the account
 * still exists, the session still works, and a retry re-runs the same
 * idempotent deletes. No transaction — a partially erased account that can
 * be retried is the right failure mode here, not a rolled-back one.
 *
 * The body must carry the account email retyped (deleteAccountSchema);
 * a session cookie alone is not enough to trigger something irreversible.
 */
export const deleteAccount = async (req: AuthRequest, res: Response) => {
    try {
        const user = await User.findById(req.user!.id);
        if (!user) {
            clearAuthCookie(res);
            return res.status(404).json({ error: 'User not found.' });
        }

        const { confirmEmail } = req.body as DeleteAccountInput;
        if (confirmEmail !== user.email) {
            return res.status(400).json({ error: 'The email you typed does not match this account.' });
        }

        // Firm client files belong to the firm, not to whoever created them —
        // a legal assistant closing their account must not erase them. The one
        // exception is a firm the user is alone in: nobody else could ever
        // reach those records again, so they go with the account.
        const orgId = user.organizationId;
        let soleMember = false;
        if (orgId) {
            const [memberCount, supervisorCount] = await Promise.all([
                User.countDocuments({ organizationId: orgId }),
                User.countDocuments({ organizationId: orgId, organizationRole: 'supervisor' }),
            ]);
            soleMember = memberCount <= 1;
            if (!soleMember && user.organizationRole === 'supervisor' && supervisorCount <= 1) {
                return res.status(409).json({
                    error: 'You are the only supervisor of your firm. Make another member a supervisor before deleting your account.',
                });
            }
        }
        const erasable = soleMember
            ? { $or: [{ userId: user._id, organizationId: null }, { organizationId: orgId }] }
            : { userId: user._id, organizationId: null };

        const companies = await Company.find(erasable)
            .select('_id incorporationDocumentFile')
            .lean();
        const companyIds = companies.map((c) => c._id);
        const events = await CorporateEvent.find({ companyId: { $in: companyIds } })
            .select('attachments')
            .lean();

        const fileIds = [
            ...companies.map((c) => c.incorporationDocumentFile).filter((f): f is string => !!f),
            ...events.flatMap((e) => (e.attachments ?? []).map((a) => a.fileId)),
        ];
        // deleteFile is best-effort and never throws — an S3 hiccup must not
        // leave the account half-alive. Files that survive are unreachable
        // once the rows below are gone (UUID keys, no listing endpoint).
        await Promise.all(fileIds.map((id) => deleteFile(id)));

        // The user's own activity goes, except entries on firm companies that
        // survive — those are the firm's audit trail.
        const keptFirmCompanyIds = orgId && !soleMember
            ? await Company.find({ organizationId: orgId }).distinct('_id')
            : [];
        await Promise.all([
            CompanyShare.deleteMany({ companyId: { $in: companyIds } }),
            CorporateEvent.deleteMany({ companyId: { $in: companyIds } }),
            DocumentModel.deleteMany({ companyId: { $in: companyIds } }),
            ActivityLog.deleteMany({
                $or: [
                    { userId: user._id, companyId: { $nin: keptFirmCompanyIds } },
                    { companyId: { $in: companyIds } },
                ],
            }),
        ]);
        await Company.deleteMany({ _id: { $in: companyIds } });
        if (orgId && soleMember) await Organization.deleteOne({ _id: orgId });
        await User.deleteOne({ _id: user._id });

        clearAuthCookie(res);
        // Counts only — the email is personal data and this is the one log
        // line that outlives the account.
        console.log(
            `[deleteAccount] user ${user._id} erased — ${companies.length} companies, ` +
            `${events.length} events, ${fileIds.length} files`,
        );
        return res.json({ ok: true });
    } catch (error: any) {
        return serverError(res, 'deleteAccount', error);
    }
};
