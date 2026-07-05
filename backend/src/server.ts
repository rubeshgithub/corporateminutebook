import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { connectDB } from './config/db';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
}));
app.use(helmet());
app.use(morgan('dev'));
// JSON parser — the verify hook stashes the raw bytes on req.rawBody so
// the CRS feed endpoint can HMAC-verify against exactly what was sent.
app.use(express.json({
    verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
}));
app.use(express.urlencoded({ extended: true }));

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
});
