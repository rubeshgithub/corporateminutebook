import cron from 'node-cron';
import { Company } from '../models/Company';
import { User } from '../models/User';
import { sendFyeReminderEmail, sendAnnualReturnReminderEmail } from './emailService';

/**
 * Daily notification scheduler. Runs once per day (in production) and looks
 * for corporations whose fiscal year end or annual return due date falls
 * inside the reminder window. Sends at most one reminder per company per
 * calendar year — dedupe is stored on Company.notifications so a daily
 * cron doesn't spam.
 *
 * Two triggers per company:
 *   - FYE reminder — 30 days before fiscal year end
 *   - Annual return reminder — 30 days before AR due date
 *
 * The FYE and AR dates are stored on Company as MM-DD strings. We resolve
 * them relative to today to get the next occurrence, then check if that
 * occurrence is inside the reminder window.
 *
 * Guarded by NOTIFICATIONS_ENABLED env var so local dev doesn't fire the
 * cron accidentally. Set NOTIFICATIONS_ENABLED=true in production only.
 */

const REMINDER_WINDOW_DAYS = 30;

function parseMMDD(mmdd: string | undefined): [number, number] | null {
    if (!mmdd) return null;
    const m = mmdd.match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return [month, day];
}

/**
 * Given an MM-DD anniversary and today, returns the next occurrence of
 * that anniversary (today or later). Handles rollover into next year.
 */
function nextOccurrence(mmdd: [number, number], today: Date): Date {
    const [month, day] = mmdd;
    const thisYear = new Date(today.getFullYear(), month - 1, day);
    if (thisYear >= startOfDay(today)) return thisYear;
    return new Date(today.getFullYear() + 1, month - 1, day);
}

function daysBetween(a: Date, b: Date): number {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / MS_PER_DAY);
}

function startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

/** Look up the owner's email in one shot per user id. Cheap enough with
 *  small user counts; if this ever gets big we can batch with $in.
 *  Returns null for opted-out users — CASL: an unsubscribed recipient
 *  must receive no further reminder emails at all. */
async function ownerEmail(userId: any): Promise<string | null> {
    const u = await User.findById(userId).select('email reminderOptOut').lean();
    if (!u?.email || u.reminderOptOut) return null;
    return u.email;
}

/**
 * Runs the full notification pass. Exposed as an export so we can trigger
 * it manually from an admin endpoint if operators want to force a run,
 * and so tests can invoke it without waiting on the cron trigger.
 */
export async function runNotificationsPass(): Promise<{ fyeSent: number; arSent: number; scanned: number }> {
    const today = startOfDay(new Date());
    const currentYear = today.getFullYear();

    const companies = await Company.find({ deletedAt: null }).lean();

    let fyeSent = 0;
    let arSent = 0;

    for (const c of companies) {
        try {
            const email = await ownerEmail(c.userId);
            if (!email) continue;

            // ─── FYE reminder ───────────────────────────────────────
            const fyeParts = parseMMDD(c.fiscalYearEnd);
            if (fyeParts) {
                const nextFye = nextOccurrence(fyeParts, today);
                const days = daysBetween(today, nextFye);
                const lastRemindedYear = c.notifications?.fyeRemindedForYear ?? 0;
                if (days > 0 && days <= REMINDER_WINDOW_DAYS && lastRemindedYear !== nextFye.getFullYear()) {
                    await sendFyeReminderEmail({
                        to:          email,
                        companyName: c.name,
                        fyeDate:     nextFye,
                        companyId:   String(c._id),
                        daysUntil:   days,
                    });
                    await Company.updateOne(
                        { _id: c._id },
                        { $set: { 'notifications.fyeRemindedForYear': nextFye.getFullYear() } },
                    );
                    fyeSent++;
                }
            }

            // ─── Annual return reminder ─────────────────────────────
            const arParts = parseMMDD(c.annualReturnDueDate);
            if (arParts) {
                const nextAr = nextOccurrence(arParts, today);
                const days = daysBetween(today, nextAr);
                const lastRemindedYear = c.notifications?.annualReturnRemindedForYear ?? 0;
                if (days > 0 && days <= REMINDER_WINDOW_DAYS && lastRemindedYear !== nextAr.getFullYear()) {
                    await sendAnnualReturnReminderEmail({
                        to:          email,
                        companyName: c.name,
                        dueDate:     nextAr,
                        companyId:   String(c._id),
                        daysUntil:   days,
                    });
                    await Company.updateOne(
                        { _id: c._id },
                        { $set: { 'notifications.annualReturnRemindedForYear': nextAr.getFullYear() } },
                    );
                    arSent++;
                }
            }
        } catch (e: any) {
            // Never let a single company's failure kill the whole pass —
            // deliverability of the rest matters more than diagnosing one.
            console.error(`[notifications] company ${c._id} failed: ${e?.message ?? e}`);
        }
    }

    console.info(`[notifications] pass complete — scanned ${companies.length}, sent ${fyeSent} FYE + ${arSent} AR reminders (year ${currentYear})`);
    return { fyeSent, arSent, scanned: companies.length };
}

/**
 * Boot the daily cron. Guarded by NOTIFICATIONS_ENABLED — set true in
 * production so we don't fire test emails from dev.
 */
export function startNotificationScheduler(): void {
    if (process.env.NOTIFICATIONS_ENABLED !== 'true') {
        console.info('[notifications] scheduler disabled (set NOTIFICATIONS_ENABLED=true to enable)');
        return;
    }
    // 09:00 UTC daily — early enough to land before a workday in Canada.
    cron.schedule('0 9 * * *', () => {
        runNotificationsPass().catch((e) => console.error('[notifications] pass crashed:', e));
    }, { timezone: 'UTC' });
    console.info('[notifications] scheduler started (09:00 UTC daily)');
}
