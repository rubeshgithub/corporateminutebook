import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { connectDB } from './config/db';
import { startNotificationScheduler } from './services/notificationScheduler';
import { startRegistryDriftChecker } from './services/registryDriftChecker';

dotenv.config();

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

app.get('/api/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', message: 'Corporate Minute Book API is running' });
});

// Generic Error Handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
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
