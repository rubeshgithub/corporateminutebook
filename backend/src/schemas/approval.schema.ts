import { z } from 'zod';
import { objectId } from './common';

const note = z.string().trim().max(2000);

/** Submit / approve / reopen — an optional note for the other side. */
export const approvalNoteSchema = z.object({ note: note.optional() });

/** Request changes — the preparer needs to know what to fix. */
export const requestChangesSchema = z.object({
    note: note.min(1, 'Tell the preparer what needs to change.'),
});

export const companyIdParam = z.object({ id: objectId });
