import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';

/**
 * Storage abstraction for uploaded files (event attachments, incorporation
 * PDFs). Historically these were written to `backend/uploads/` on disk,
 * which meant every Render deploy wiped customer attachments — a bug that
 * would silently destroy data in production.
 *
 * Behaviour:
 *   - If S3_ATTACHMENTS_BUCKET is set → all writes go to S3, reads try S3
 *     first, fall back to local disk (so files uploaded before the migration
 *     stay readable until the dyno rotates and the disk is wiped).
 *   - If S3_ATTACHMENTS_BUCKET is NOT set → dev mode; everything stays on
 *     disk. No environment change required for local development.
 *
 * AWS credentials + region are reused from the existing SES setup
 * (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION). Ops just needs
 * to create the bucket and set the single env var.
 */

const LOCAL_UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(LOCAL_UPLOADS_DIR)) fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });

const S3_BUCKET = process.env.S3_ATTACHMENTS_BUCKET;
const S3_PREFIX = process.env.S3_ATTACHMENTS_PREFIX ?? 'attachments/';

let _s3: S3Client | null = null;
function s3(): S3Client {
    if (!_s3) {
        _s3 = new S3Client({
            // S3_REGION lets the attachments bucket live in ca-central-1
            // (Canadian data residency) while SES keeps sending from the
            // region its identity is verified in (AWS_REGION).
            region: process.env.S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
            credentials: {
                accessKeyId:     process.env.AWS_ACCESS_KEY_ID     ?? '',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
            },
        });
    }
    return _s3;
}

export function isS3Enabled(): boolean {
    return !!S3_BUCKET;
}

function objectKey(fileId: string): string {
    // fileId already unique (UUID-based) — S3 key just adds the prefix.
    return `${S3_PREFIX}${fileId}`;
}

function localPath(fileId: string): string {
    return path.join(LOCAL_UPLOADS_DIR, fileId);
}

/** Write bytes for the given fileId. Idempotent — overwrite is safe. */
export async function putFile(fileId: string, body: Buffer, contentType?: string): Promise<void> {
    if (isS3Enabled()) {
        await s3().send(new PutObjectCommand({
            Bucket:      S3_BUCKET,
            Key:         objectKey(fileId),
            Body:        body,
            ContentType: contentType,
        }));
        return;
    }
    fs.writeFileSync(localPath(fileId), body);
}

/**
 * Fetch bytes for the given fileId. When S3 is enabled we try S3 first,
 * then fall back to local disk (for files uploaded before the migration).
 * Throws on complete miss.
 */
export async function getFile(fileId: string): Promise<Buffer> {
    if (isS3Enabled()) {
        try {
            const out = await s3().send(new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key:    objectKey(fileId),
            }));
            if (!out.Body) throw new Error(`Empty body for ${fileId}`);
            const chunks: Buffer[] = [];
            for await (const chunk of out.Body as AsyncIterable<Buffer>) {
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        } catch (e) {
            if (!(e instanceof NoSuchKey)) {
                // Real error (permissions, network, etc.) — re-throw so the
                // caller sees it and can log / return 500. Missing-key falls
                // through to the local-disk fallback below.
                throw e;
            }
        }
    }
    const p = localPath(fileId);
    if (!fs.existsSync(p)) throw new Error(`File not found: ${fileId}`);
    return fs.readFileSync(p);
}

/** Same as getFile but returns null on miss instead of throwing. */
export async function tryGetFile(fileId: string): Promise<Buffer | null> {
    try {
        return await getFile(fileId);
    } catch {
        return null;
    }
}

/** Existence check that never throws. Used by PDF-append code. */
export async function fileExists(fileId: string): Promise<boolean> {
    if (isS3Enabled()) {
        try {
            await s3().send(new HeadObjectCommand({
                Bucket: S3_BUCKET,
                Key:    objectKey(fileId),
            }));
            return true;
        } catch {
            // fall through to disk check
        }
    }
    return fs.existsSync(localPath(fileId));
}

/** Best-effort delete — never throws so cleanup paths can call it safely. */
export async function deleteFile(fileId: string): Promise<void> {
    if (isS3Enabled()) {
        try {
            await s3().send(new DeleteObjectCommand({
                Bucket: S3_BUCKET,
                Key:    objectKey(fileId),
            }));
        } catch { /* best-effort */ }
    }
    try {
        const p = localPath(fileId);
        if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch { /* best-effort */ }
}
