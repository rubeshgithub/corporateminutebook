import type { Types } from 'mongoose';
import { Company } from '../models/Company';
import { EDIT_RESETS_FROM } from '../utils/approval';

/** History entries kept per company — enough for an audit trail, bounded so a
 *  busy book can't grow the document forever. */
export const APPROVAL_HISTORY_LIMIT = 50;

/**
 * A content change (company details, or a recorded / edited / deleted event)
 * means what was approved or submitted is no longer what the book says, so it
 * returns to draft. Uploading signed copies does not come through here —
 * collecting signatures is what happens after approval.
 */
export const resetApprovalOnEdit = async (companyId: Types.ObjectId | string, userId: string | undefined): Promise<boolean> => {
    const result = await Company.updateOne(
        { _id: companyId, 'approval.status': { $in: EDIT_RESETS_FROM } },
        {
            $set: { 'approval.status': 'draft', 'approval.note': '' },
            $push: {
                'approval.history': {
                    $each: [{ action: 'reset_by_edit', by: userId ?? null, at: new Date() }],
                    $slice: -APPROVAL_HISTORY_LIMIT,
                },
            },
        },
    );
    return result.modifiedCount > 0;
};
