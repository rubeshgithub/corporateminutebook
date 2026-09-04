import { Request, Response } from 'express';
import { User } from '../models/User';
import { verifyUnsubscribeToken } from '../utils/unsubscribe';
import { serverError } from '../utils/apiError';

/**
 * GET/POST /api/email/unsubscribe/:token
 *
 * CASL unsubscribe endpoint for reminder emails. GET serves the human who
 * clicked the footer link; POST serves RFC 8058 one-click unsubscribe
 * (the List-Unsubscribe-Post header), which mail clients fire without any
 * confirmation UI. Both must succeed with no session — the recipient may
 * never have logged in (crs_seeded accounts).
 *
 * Idempotent, and deliberately does not reveal whether the email has an
 * account: a forged-but-validly-signed token is impossible (JWT), and an
 * invalid token gets a neutral failure page.
 */

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — MinuteBook</title></head>
<body style="font-family:Arial,sans-serif;max-width:480px;margin:15vh auto 0;padding:0 1.5rem;color:#222;line-height:1.6">
<h2 style="color:#1a237e">${title}</h2>${body}
<p style="color:#888;font-size:13px;margin-top:32px">MinuteBook — Corporate Records Management</p>
</body></html>`;

export const unsubscribe = async (req: Request, res: Response) => {
    try {
        const email = verifyUnsubscribeToken(String(req.params.token ?? ''));
        if (!email) {
            return res.status(400).send(page(
                'Link not recognized',
                '<p>This unsubscribe link is invalid or was truncated by your mail client. ' +
                'Copy the full link from the email, or contact support and we will remove you manually.</p>',
            ));
        }

        // Idempotent: unsubscribing twice, or unsubscribing an address with no
        // account, both land on the same confirmation.
        await User.updateOne(
            { email },
            { $set: { reminderOptOut: true, reminderOptOutAt: new Date() } },
        );

        // One-click POSTs come from the mail client, not a person — a 200 with
        // any body satisfies RFC 8058.
        return res.status(200).send(page(
            'You are unsubscribed',
            `<p><strong>${email}</strong> will no longer receive fiscal-year-end or annual-return reminder emails from MinuteBook.</p>` +
            '<p>Sign-in codes and documents you request yourself are unaffected. ' +
            'To turn reminders back on, sign in to MinuteBook and use the Account page.</p>',
        ));
    } catch (error) {
        return serverError(res, 'unsubscribe', error);
    }
};
