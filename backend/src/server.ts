import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import * as Sentry from '@sentry/node';
import { connectDB } from './config/db';
import { validateEnv } from './config/env';
import { csrfGuard } from './middleware/csrf';
import { startNotificationScheduler } from './services/notificationScheduler';
import { startRegistryDriftChecker } from './services/registryDriftChecker';

dotenv.config();

// Fail the boot on missing required config rather than 500ing at first use.
validateEnv();

// Error tracking — no-ops without a DSN (warned at boot by validateEnv).
// Every serverError() call and the global handler below report through this.
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
    });
}

const app: Express = express();
const PORT = process.env.PORT || 5000;

// Render is a single-hop reverse proxy — trust it so express-rate-limit sees
// the real client IP from X-Forwarded-For instead of bucketing every request
// under the proxy's address. Number matches Render's exactly-one-hop setup.
app.set('trust proxy', 1);

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
}));
app.use(helmet());
app.use(morgan('dev'));

// Global rate limit — generous. Catches broad scraping / abuse without
// impacting legitimate use (a full session of dashboard + builder + records
// is well under 200 req/min per IP).
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Slow down and try again.' },
});
app.use('/api', globalLimiter);

// Body size caps — before this, express.json() defaulted to a 100 KB soft
// limit that many client bugs can exceed silently. Multer routes get their
// own file-size limits; these caps only affect application/json bodies.
// 1 MB is plenty for the largest write (a company with many shareholders).
app.use(express.json({
    limit: '1mb',
    // JSON verify hook stashes raw bytes on req.rawBody so the CRS feed
    // endpoint can HMAC-verify against exactly what was sent.
    verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
// Auth token is stored in an httpOnly cookie — cookie-parser hydrates
// req.cookies so authMiddleware.protect can read it.
app.use(cookieParser());

// CSRF guard runs after cookieParser (it reads the auth cookie) and before
// any route. Safe methods and cookie-less requests pass straight through.
app.use('/api', csrfGuard);

// Routes
import authRoutes from './routes/authRoutes';
import companyRoutes from './routes/companyRoutes';
import documentRoutes from './routes/documentRoutes';
import registryRoutes from './routes/registryRoutes';
import activityRoutes from './routes/activityRoutes';
import statsRoutes from './routes/statsRoutes';
import incorporationRoutes from './routes/incorporationRoutes';
import eventRoutes from './routes/eventRoutes';
import crsFeedRoutes from './routes/crsFeedRoutes';
import shareRoutes from './routes/shareRoutes';
import emailRoutes from './routes/emailRoutes';

// Basic Route
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/registry', registryRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/incorporation', incorporationRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/crs-feed', crsFeedRoutes);
// Sharing routes contribute BOTH /api/share/:token (public) AND owner-scoped
// /api/companies/:id/shares + /api/shares/:shareId (auth-guarded inside).
app.use('/api', shareRoutes);
// CASL unsubscribe — public, token-in-URL (see emailRoutes).
app.use('/api/email', emailRoutes);

/**
 * Health check. Reports degraded (503) when the database is unreachable so an
 * uptime monitor actually catches a broken instance — a static 200 told us
 * only that the process had not crashed.
 */
app.get('/api/health', async (_req: Request, res: Response) => {
    // 1 === connected, per mongoose.ConnectionStates
    const dbUp = mongoose.connection.readyState === 1;
    let dbPing = false;
    if (dbUp) {
        try {
            await mongoose.connection.db!.admin().ping();
            dbPing = true;
        } catch {
            dbPing = false;
        }
    }

    const healthy = dbUp && dbPing;
    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        database: healthy ? 'connected' : 'unavailable',
        uptimeSeconds: Math.round(process.uptime()),
    });
});

// Generic Error Handler
app.use((err: Error & { status?: number; statusCode?: number; type?: string }, req: Request, res: Response, next: NextFunction) => {
    // Errors raised by the body parsers carry a 4xx status (malformed JSON,
    // body over the 1 MB cap, unsupported charset). Those are the client's
    // fault: answer with that status and keep them out of Sentry — before
    // this, a curl typo showed up as a 500 in error tracking.
    const status = Number(err.status ?? err.statusCode);
    if (status >= 400 && status < 500) {
        const message =
            err.type === 'entity.parse.failed' ? 'Malformed JSON body.' :
            err.type === 'entity.too.large'    ? 'Request body too large (max 1 MB).' :
            'Bad request.';
        return res.status(status).json({ error: message });
    }
    // No-op when Sentry.init didn't run (no DSN).
    Sentry.captureException(err);
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // Boot the background scheduled jobs after the HTTP listener is up so
    // failures in a job don't prevent health checks from responding.
    // Each scheduler is env-guarded — dev boots without them.
    startNotificationScheduler();
    startRegistryDriftChecker();
});
