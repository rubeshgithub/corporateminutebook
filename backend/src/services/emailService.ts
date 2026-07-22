import nodemailer from 'nodemailer';
import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
});

const FROM = process.env.SES_FROM || 'MinuteBook <rubesh@insteadglobal.com>';

const sendMail = async (opts: nodemailer.SendMailOptions) => {
    const builder = nodemailer.createTransport({ streamTransport: true, newline: 'unix', buffer: true });
    const { message } = await builder.sendMail(opts);
    await ses.send(new SendRawEmailCommand({ RawMessage: { Data: message as Buffer } }));
};

export const sendOtpEmail = async (opts: { to: string; code: string }) => {
    const { to, code } = opts;
    await sendMail({
        from: FROM,
        to,
        subject: `${code} — your MinuteBook sign-in code`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#222">
                <h2 style="color:#1a237e">Your sign-in code</h2>
                <p>Use this code to sign in to MinuteBook. It expires in 10 minutes.</p>
                <div style="font-size:2.5rem;font-weight:700;letter-spacing:0.35em;background:#f0f4ff;border-left:4px solid #1a237e;padding:1rem 1.5rem;margin:1.5rem 0;color:#1a237e;text-align:center">
                    ${code}
                </div>
                <p style="color:#888;font-size:13px">If you didn't request this code, ignore this email.</p>
                <p style="color:#888;font-size:13px">Sent via MinuteBook — Corporate Records Management</p>
            </div>`,
    });
};

const APP_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Fiscal-year-end reminder — fires 30 days before FYE. Framed for the
 * business owner + their accountant: this is the moment annual director
 * and shareholder resolutions get dated, and the T2 corporate tax return
 * cycle begins.
 */
export const sendFyeReminderEmail = async (opts: {
    to: string;
    companyName: string;
    fyeDate: Date;
    companyId: string;
    daysUntil: number;
}) => {
    const { to, companyName, fyeDate, companyId, daysUntil } = opts;
    const fyeLabel = fyeDate.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });
    const url = `${APP_URL}/records/${companyId}?openEvent=1`;

    await sendMail({
        from: FROM,
        to,
        subject: `${companyName}: fiscal year-end in ${daysUntil} days`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;line-height:1.6">
                <h2 style="color:#1a237e;margin-bottom:8px">Your fiscal year end is approaching</h2>
                <p style="color:#666;margin:0 0 24px 0">A short heads-up for <strong>${companyName}</strong> — ${daysUntil} days to go.</p>

                <div style="background:#f0f4ff;border-left:4px solid #1a237e;padding:16px 20px;margin:0 0 24px 0">
                    <div style="font-size:13px;color:#666;letter-spacing:0.05em;text-transform:uppercase;font-weight:600">Fiscal year end</div>
                    <div style="font-size:20px;font-weight:700;color:#1a237e;margin-top:4px">${fyeLabel}</div>
                </div>

                <p><strong>What typically needs to happen around FYE:</strong></p>
                <ul>
                    <li>Annual director resolution (adopts financial statements, waives audit if applicable)</li>
                    <li>Annual shareholder resolution (elects directors, appoints or waives auditor)</li>
                    <li>Any dividend declarations for the fiscal year</li>
                </ul>

                <p>You can record all of these directly in MinuteBook — signed copies will slot into your compiled book.</p>

                <div style="margin:28px 0">
                    <a href="${url}" style="display:inline-block;background:#1a237e;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Record an event →</a>
                </div>

                <p style="color:#888;font-size:12px;margin-top:32px">You're receiving this because ${companyName} has this fiscal year end on file with MinuteBook. To adjust or turn off reminders, edit the company in the app.</p>
            </div>`,
    });
};

/**
 * Annual-return reminder — fires 30 days before the AR due date. Wording
 * intentionally direct: missing the AR triggers a notice-of-intent-to-
 * dissolve in most Canadian jurisdictions, and that costs money to
 * reverse. Owners routinely forget.
 */
export const sendAnnualReturnReminderEmail = async (opts: {
    to: string;
    companyName: string;
    dueDate: Date;
    companyId: string;
    daysUntil: number;
}) => {
    const { to, companyName, dueDate, companyId, daysUntil } = opts;
    const dueLabel = dueDate.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });
    const url = `${APP_URL}/records/${companyId}`;

    await sendMail({
        from: FROM,
        to,
        subject: `${companyName}: annual return due in ${daysUntil} days`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;line-height:1.6">
                <h2 style="color:#b71c1c;margin-bottom:8px">Annual return due in ${daysUntil} days</h2>
                <p style="color:#666;margin:0 0 24px 0">${companyName} — file this before the deadline to keep the corporation in good standing.</p>

                <div style="background:#fff8e1;border-left:4px solid #f9a825;padding:16px 20px;margin:0 0 24px 0">
                    <div style="font-size:13px;color:#8a6d1f;letter-spacing:0.05em;text-transform:uppercase;font-weight:600">Deadline</div>
                    <div style="font-size:20px;font-weight:700;color:#8a6d1f;margin-top:4px">${dueLabel}</div>
                </div>

                <p><strong>What happens if you miss it:</strong></p>
                <ul>
                    <li>Registry issues a notice of intent to dissolve</li>
                    <li>Corporation loses good standing (blocks bank loans, extra-provincial registrations, grants)</li>
                    <li>Eventually, the corporation is struck from the registry — revival costs several hundred to several thousand dollars</li>
                </ul>

                <p><strong>Two ways to file:</strong></p>
                <ul>
                    <li>File it yourself directly through your provincial or federal registry portal</li>
                    <li>Have CRS file it for you — $99 all-in, filed within 24 hours (<a href="https://www.corporateregistryservices.ca/annual-return" style="color:#1a237e">order here</a>)</li>
                </ul>

                <p>Once it's filed, log the confirmation in MinuteBook as an "Annual Return Filed" event so your minute book stays current.</p>

                <div style="margin:28px 0">
                    <a href="${url}" style="display:inline-block;background:#1a237e;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Open ${companyName} →</a>
                </div>

                <p style="color:#888;font-size:12px;margin-top:32px">You're receiving this because ${companyName}'s annual return date is on file with MinuteBook.</p>
            </div>`,
    });
};

/**
 * Sharing invitation — a CPA / lawyer / partner has been given read-only
 * access to a company's minute book. The share link IS the credential;
 * no MinuteBook account required. Deliberately understated: this is a
 * professional service exchange, not a marketing email.
 */
export const sendShareInviteEmail = async (opts: {
    to:            string;
    inviterName:   string;
    companyName:   string;
    shareUrl:      string;
    label?:        string;
    expiresAt:     Date;
}) => {
    const { to, inviterName, companyName, shareUrl, label, expiresAt } = opts;
    const expiresLabel = expiresAt.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });

    await sendMail({
        from: FROM,
        to,
        subject: `${inviterName} shared ${companyName} minute book with you`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#222;line-height:1.6">
                <h2 style="color:#1a237e;margin-bottom:8px">You have read-only access to a minute book</h2>
                <p style="color:#666;margin:0 0 24px 0"><strong>${inviterName}</strong> has shared the corporate minute book for <strong>${companyName}</strong> with you.${label ? ` <em>(${label})</em>` : ''}</p>

                <p>The link below is read-only. You can review the corporation's current directors, share structure, recorded events, and download the compiled minute book — but you can't edit anything.</p>

                <div style="margin:28px 0">
                    <a href="${shareUrl}" style="display:inline-block;background:#1a237e;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Open ${companyName}</a>
                </div>

                <p style="color:#666;font-size:13px"><strong>Access expires ${expiresLabel}.</strong> The link is the credential — no sign-in required. Don't forward it if you don't want others viewing this record.</p>

                <p style="color:#888;font-size:12px;margin-top:32px">Sent via MinuteBook — Corporate Records Management. If you weren't expecting this, you can safely ignore the email.</p>
            </div>`,
    });
};

export const sendResolutionEmail = async (opts: {
    to: string;
    recipientName: string;
    companyName: string;
    eventLabel: string;
    pdfBuffer: Buffer;
    pdfFilename: string;
}) => {
    const { to, recipientName, companyName, eventLabel, pdfBuffer, pdfFilename } = opts;

    await sendMail({
        from: FROM,
        to,
        subject: `Resolution for review — ${companyName}`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222">
                <h2 style="color:#1a237e">Resolution for Review</h2>
                <p>Hi ${recipientName},</p>
                <p>Please find attached a resolution prepared for <strong>${companyName}</strong> regarding:</p>
                <p style="background:#f0f4ff;border-left:4px solid #1a237e;padding:10px 16px;margin:16px 0;font-weight:600">${eventLabel}</p>
                <p>Please review the attached PDF and return a signed copy.</p>
                <p style="color:#888;font-size:13px">Sent via MinuteBook — Corporate Records Management</p>
            </div>`,
        attachments: [{
            filename:    pdfFilename,
            content:     pdfBuffer,
            contentType: 'application/pdf',
        }],
    });
};
