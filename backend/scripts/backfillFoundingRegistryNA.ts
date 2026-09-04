/**
 * One-time backfill: flag founding events as registryFilingNotApplicable.
 *
 * Companies created before the flag existed have founding director /
 * officer / share-issuance events that still count as "missing a registry
 * filing", so the dashboard shows spurious compliance gaps. New companies
 * get the flag at creation (companyController.createFoundingEvents); this
 * catches up the existing rows with the same rule.
 *
 * Usage (from backend/, MONGODB_URI read from .env or the shell):
 *   npm run backfill:founding-na              # dry run — counts only
 *   npm run backfill:founding-na -- --apply   # writes
 *
 * Idempotent: the filter excludes rows already flagged, so re-running
 * after --apply reports zero.
 */
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import { CorporateEvent } from '../src/models/CorporateEvent';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const FOUNDING_EVENT_TYPES = ['director_appointed', 'officer_appointed', 'shares_issued'];

async function main() {
    const apply = process.argv.includes('--apply');
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI is not set — put it in backend/.env or export it.');
        process.exit(1);
    }

    await mongoose.connect(uri);

    const filter = {
        notes: 'Founding',
        eventType: { $in: FOUNDING_EVENT_TYPES },
        registryFilingNotApplicable: { $ne: true },
    };

    const pending = await CorporateEvent.countDocuments(filter);
    const companies = await CorporateEvent.distinct('companyId', filter);
    console.log(`${pending} founding event(s) across ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'} still count as missing a registry filing.`);

    if (!apply) {
        console.log('Dry run — nothing written. Re-run with --apply to flag them.');
    } else if (pending > 0) {
        const result = await CorporateEvent.updateMany(filter, { $set: { registryFilingNotApplicable: true } });
        console.log(`Flagged ${result.modifiedCount} event(s) as registryFilingNotApplicable.`);
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
