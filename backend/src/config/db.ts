import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connects to MongoDB with bounded exponential backoff.
 *
 * A transient Atlas blip during a deploy used to exit the process immediately,
 * which on a restart-on-crash host turns one hiccup into a crash loop. We now
 * retry a few times first, and only give up — loudly — if the database is
 * genuinely unreachable. Mongoose handles reconnection on its own after the
 * initial connection succeeds; the listeners below just make those transitions
 * visible in the logs.
 */
export const connectDB = async () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const conn = await mongoose.connect(process.env.MONGODB_URI as string);
            console.log(`MongoDB connected: ${conn.connection.host}`);

            mongoose.connection.on('disconnected', () => console.warn('[db] MongoDB disconnected'));
            mongoose.connection.on('reconnected', () => console.log('[db] MongoDB reconnected'));
            mongoose.connection.on('error', (err) => console.error(`[db] MongoDB error: ${err.message}`));
            return;
        } catch (error: any) {
            const isLast = attempt === MAX_ATTEMPTS;
            console.error(
                `[db] Connection attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}` +
                (isLast ? '' : ' — retrying'),
            );
            if (isLast) {
                console.error('[db] Could not reach MongoDB. Check MONGODB_URI and network access rules.');
                process.exit(1);
            }
            await wait(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
    }
};
