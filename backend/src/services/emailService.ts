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
