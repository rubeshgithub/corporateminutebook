import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
    user?: {
        id: string;
        role: string;
    };
    // cookies is added by cookie-parser at runtime; declaring here so TS
    // sees it in protect() without having to widen the whole Request type.
    cookies?: Record<string, string>;
}

/**
 * Auth token is stored in an httpOnly cookie (see authController.setAuthCookie).
 * The old Bearer-header path has been removed as part of the one-shot cutover —
 * clients still holding a Bearer-header token get 401 and are bounced to login.
 * XSS can no longer read the credential.
 */
export const protect = (req: AuthRequest, res: Response, next: NextFunction) => {
    const token = req.cookies?.mb_auth;
    if (!token) return res.status(401).json({ error: 'Not authorized, no session.' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
        req.user = { id: decoded.id, role: decoded.role };
        return next();
    } catch {
        return res.status(401).json({ error: 'Session expired or invalid.' });
    }
};

export const adminOnly = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        return res.status(403).json({ error: 'Not authorized as an admin' });
    }
};
