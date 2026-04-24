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
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
import authRoutes from './routes/authRoutes';
import companyRoutes from './routes/companyRoutes';
import documentRoutes from './routes/documentRoutes';
import registryRoutes from './routes/registryRoutes';

// Basic Route
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/registry', registryRoutes);

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
