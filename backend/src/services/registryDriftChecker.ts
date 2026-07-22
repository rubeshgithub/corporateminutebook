import cron from 'node-cron';
import { Company } from '../models/Company';
import { searchCBRDirect, searchBCDirect, PROVINCE_CBR_MAP } from '../controllers/registryController';

/**
 * Weekly registry-drift check. For each company that has a registrySignature
 * (i.e. we know which government record it maps to), pull the current
 * registry snapshot and diff against MinuteBook's stored state. When a
 * drift is detected — the corporation's legal name changed, or its
 * registry-recognised status flipped from Active — we stamp
 * Company.drift.detectedAt + drift.fields so the dashboard can show a
 * banner: "your MinuteBook record and the government registry disagree."
 *
 * The drift check ONLY covers what the public registry endpoints return
 * (name, status, city, entity type). Deeper diffs — director rosters,
 * share structure — require per-jurisdiction paid APIs that we don't
 * currently integrate. For MVP the shallow diff still catches the two
 * biggest silent divergences: name changes filed direct with the
 * registry, and administrative-dissolution notices.
 *
 * Guarded by DRIFT_CHECK_ENABLED env var. Set to 'true' in production.
 */

interface RegistrySnapshot {
    name:   string;
    status: 'Active' | 'Inactive';
    city:   string;
}

/**
 * Look up the current registry snapshot for a company by its registrySignature.
 * Returns null if the corp can't be found (may have been fully dissolved and
 * scrubbed, or the registry is currently unavailable — we don't want a network
 * hiccup to look like a drift event).
 */
async function fetchCurrentSnapshot(provinceKey: string, registryId: string): Promise<RegistrySnapshot | null> {
    if (!registryId) return null;
    try {
        if (provinceKey === 'bc') {
            const { results } = await searchBCDirect(registryId);
            const hit = results.find((r) => r.registryId === registryId) ?? results[0];
            if (!hit) return null;
            return { name: hit.name, status: hit.status, city: hit.location.replace(/,.*$/, '').trim() };
        }
        const provinceCode = provinceKey === 'all' ? undefined : PROVINCE_CBR_MAP[provinceKey];
        const { results } = await searchCBRDirect(registryId, provinceCode);
        // Prefer an exact registryId match — fall back to first hit only if
        // no exact match exists (defensive for CBR variations in ID format).
        const hit = results.find((r) => r.registryId === registryId) ?? results[0];
        if (!hit) return null;
        return {
            name:   hit.name,
            status: hit.status,
            city:   hit.location.split(',')[0]?.trim() ?? '',
        };
    } catch {
        return null;
    }
}

function normalize(s: string): string {
    return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Runs one drift-check pass across every company with a registry signature. */
export async function runDriftCheckPass(): Promise<{ scanned: number; drifted: number; cleared: number }> {
    const companies = await Company.find({
        deletedAt: null,
        'registrySignature.registryId': { $exists: true, $ne: '' },
    }).lean();

    let drifted = 0;
    let cleared = 0;

    for (const c of companies) {
        try {
            const sig = c.registrySignature;
            if (!sig?.registryId) continue;
            const snapshot = await fetchCurrentSnapshot(sig.provinceKey, sig.registryId);
            const now = new Date();

            if (!snapshot) {
                // Couldn't reach the registry OR corp not found. Update
                // checkedAt but don't flag drift on a network failure —
                // avoid false positives.
                await Company.updateOne({ _id: c._id }, { $set: { 'drift.checkedAt': now } });
                continue;
            }

            const driftFields: string[] = [];
            if (normalize(snapshot.name) !== normalize(c.name)) driftFields.push('name');
            // Status: our source of truth is "not deletedAt = active". If the
            // registry flags Inactive while MinuteBook still treats it live,
            // that's the biggest signal.
            if (snapshot.status === 'Inactive') driftFields.push('status');
            if (snapshot.city && c.registeredOfficeAddress?.city &&
                normalize(snapshot.city) !== normalize(c.registeredOfficeAddress.city)) {
                driftFields.push('registeredOfficeCity');
            }

            const previouslyDrifted = c.drift?.detectedAt && !c.drift?.resolvedAt;

            if (driftFields.length > 0) {
                await Company.updateOne({ _id: c._id }, {
                    $set: {
                        'drift.checkedAt':  now,
                        'drift.detectedAt': now,
                        'drift.fields':     driftFields,
                        'drift.resolvedAt': null,
                    },
                });
                drifted++;
            } else if (previouslyDrifted) {
                // Cleared — previously drifted, now agrees again. Clear the
                // flag so the dashboard banner disappears.
                await Company.updateOne({ _id: c._id }, {
                    $set: {
                        'drift.checkedAt':  now,
                        'drift.detectedAt': null,
                        'drift.fields':     [],
                        'drift.resolvedAt': now,
                    },
                });
                cleared++;
            } else {
                await Company.updateOne({ _id: c._id }, { $set: { 'drift.checkedAt': now } });
            }
        } catch (e: any) {
            console.error(`[drift] company ${c._id} failed: ${e?.message ?? e}`);
        }
    }

    console.info(`[drift] pass complete — scanned ${companies.length}, ${drifted} drifted, ${cleared} cleared`);
    return { scanned: companies.length, drifted, cleared };
}

/**
 * Boot the weekly cron. Guarded by DRIFT_CHECK_ENABLED so dev doesn't hit
 * the public registry APIs unbidden.
 */
export function startRegistryDriftChecker(): void {
    if (process.env.DRIFT_CHECK_ENABLED !== 'true') {
        console.info('[drift] scheduler disabled (set DRIFT_CHECK_ENABLED=true to enable)');
        return;
    }
    // Mondays 04:00 UTC — off-peak for the free public registry APIs.
    cron.schedule('0 4 * * 1', () => {
        runDriftCheckPass().catch((e) => console.error('[drift] pass crashed:', e));
    }, { timezone: 'UTC' });
    console.info('[drift] scheduler started (Mondays 04:00 UTC)');
}
