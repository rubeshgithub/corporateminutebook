import React, { useRef, useState } from 'react';
import {
    Box, Typography, Paper, Button, Alert, Chip, CircularProgress, Checkbox, FormControlLabel,
    FormControl, FormLabel, RadioGroup, Radio, Table, TableBody, TableCell, TableHead, TableRow, Link,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { useSelector } from 'react-redux';
import api from '../utils/api';
import { useSnackbar } from '../context/SnackbarContext';

interface ReportAddress { street: string; city: string; province: string; postalCode: string; country: string }
interface Flag { level: 'blocker' | 'warning' | 'info'; code: string; message: string }
interface PlanEvent { eventType: string; effectiveDate: string; label: string; registryFilingNotApplicable: boolean }
interface Preview {
    report: {
        registry: string;
        registryName: string;
        source: 'parser' | 'ai';
        reportDate: string | null;
        corporation: {
            name: string; number: string; businessNumber: string; status: string;
            incorporationDate: string | null; entityType: string;
            minDirectors: number | null; maxDirectors: number | null;
        };
        registeredOffice: ReportAddress | null;
        recordsOffice: ReportAddress | null;
        directors: Array<{ name: string; address: string; residentCanadian: boolean | null; appointedDate: string | null }>;
        officers: Array<{ name: string; title: string; appointedDate: string | null }>;
        shareholders: Array<{ name: string; holderType: string; votingPercent: number | null }>;
    };
    plan: {
        jurisdiction: string;
        reportAgeDays: number | null;
        company: { directors: Array<{ residentCanadian: boolean }> };
        events: PlanEvent[];
        flags: Flag[];
    };
    existingCompany: { _id: string; name: string } | null;
}

const MAX_BYTES = 20 * 1024 * 1024;

const ACCEPTED = [
    ['Alberta', 'Corporate search (CORES)'],
    ['British Columbia', 'Company summary (BC Registry)'],
    ['Ontario', 'Profile report (Ontario Business Registry)'],
    ['Saskatchewan', 'Profile report (ISC Corporate Registry)'],
    ['Federal', 'Corporate profile (Corporations Canada)'],
];

const GOVERNED_BY: Record<string, string> = {
    ab: 'Alberta', bc: 'British Columbia', on: 'Ontario', sk: 'Saskatchewan', federal: 'Canada (CBCA)', other: 'Another jurisdiction',
};

const fmtDate = (iso: string | null | undefined) =>
    iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '—';

const fmtAddress = (a: ReportAddress | null) =>
    a ? [a.street, a.city, [a.province, a.postalCode].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ') : '—';

const section = { p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'white', mb: 2.5 } as const;

const Fact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <Box sx={{ minWidth: 180, flex: '1 1 180px' }}>
        <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
        <Typography variant="body2" fontWeight={500}>{value || '—'}</Typography>
    </Box>
);

/**
 * Existing corporation: read the registry profile report, show everything
 * that was read and every problem found, then create the draft book with its
 * dated history. The server re-reads the PDF on create — the report, not
 * this screen, is the source of truth.
 */
const ProfileReportImport: React.FC = () => {
    const navigate = useNavigate();
    const { showSnackbar } = useSnackbar();
    const firm: { name: string } | null = useSelector((state: any) => state.auth?.user?.organization) ?? null;
    const inputRef = useRef<HTMLInputElement>(null);

    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<Preview | null>(null);
    const [reading, setReading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [workspace, setWorkspace] = useState<'firm' | 'personal'>(firm ? 'firm' : 'personal');
    const [staleOk, setStaleOk] = useState(false);
    const [duplicateId, setDuplicateId] = useState<string | null>(null);

    const read = async (f: File) => {
        setError(null);
        if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
            setError('Upload the profile report as a PDF, exactly as the registry issued it.');
            return;
        }
        if (f.size > MAX_BYTES) {
            setError('That PDF is over 20 MB. Profile reports are usually well under 1 MB — check you picked the right file.');
            return;
        }
        setFile(f);
        setReading(true);
        try {
            const form = new FormData();
            form.append('report', f);
            const { data } = await api.post<Preview>('/profile-reports/preview', form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setPreview(data);
            setStaleOk(false);
            setDuplicateId(null);
        } catch (err: any) {
            setError(err?.response?.data?.error || 'The report could not be read. Please try again.');
            setFile(null);
        } finally {
            setReading(false);
        }
    };

    const startOver = () => {
        setPreview(null);
        setFile(null);
        setError(null);
        setDuplicateId(null);
        if (inputRef.current) inputRef.current.value = '';
    };

    const create = async () => {
        if (!file || !preview) return;
        setCreating(true);
        setError(null);
        try {
            const form = new FormData();
            form.append('report', file);
            form.append('workspace', firm ? workspace : 'personal');
            if (staleOk) form.append('acknowledgeStale', 'true');
            const { data } = await api.post<{ companyId: string }>('/profile-reports/import', form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            showSnackbar(`${preview.report.corporation.name} added as a draft. Upload the documents each record asks for.`, 'success');
            navigate(`/records/${data.companyId}`);
        } catch (err: any) {
            const body = err?.response?.data;
            if (body?.companyId) setDuplicateId(body.companyId);
            setError(body?.error || 'The minute book could not be created. Please try again.');
        } finally {
            setCreating(false);
        }
    };

    // ── Upload ──────────────────────────────────────────────────────────
    if (!preview) {
        return (
            <Box sx={{ p: 3, bgcolor: '#f5f6fa', minHeight: '100vh' }}>
                <Box mb={2.5}>
                    <Typography variant="h5" fontWeight={700} lineHeight={1.2}>Existing corporation</Typography>
                    <Typography variant="body2" color="text.secondary" mt={0.3}>
                        Upload its current profile report, straight from the registry and dated within the last 30 days.
                    </Typography>
                </Box>

                <Box sx={{ maxWidth: 760 }}>
                    {error && <Alert severity="error" sx={{ mb: 2.5 }}>{error}</Alert>}

                    <Paper
                        elevation={0}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setDragOver(false);
                            const f = e.dataTransfer.files?.[0];
                            if (f && !reading) read(f);
                        }}
                        sx={{
                            ...section,
                            p: 5, textAlign: 'center', borderStyle: 'dashed', borderWidth: 2,
                            borderColor: dragOver ? 'primary.main' : 'divider',
                            bgcolor: dragOver ? 'rgba(26,35,126,0.04)' : 'white',
                        }}
                    >
                        {reading ? (
                            <Box display="flex" flexDirection="column" alignItems="center" gap={1.5}>
                                <CircularProgress size={32} />
                                <Typography variant="body2" color="text.secondary">Reading {file?.name}…</Typography>
                            </Box>
                        ) : (
                            <>
                                <UploadFileIcon sx={{ fontSize: 40, color: 'primary.main', mb: 1 }} />
                                <Typography variant="subtitle1" fontWeight={600}>Drop the profile report PDF here</Typography>
                                <Typography variant="body2" color="text.secondary" mb={2}>or</Typography>
                                <Button variant="contained" component="label">
                                    Choose PDF
                                    <input
                                        ref={inputRef}
                                        hidden
                                        type="file"
                                        accept="application/pdf,.pdf"
                                        onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }}
                                    />
                                </Button>
                            </>
                        )}
                    </Paper>

                    <Paper elevation={0} sx={section}>
                        <Typography variant="subtitle2" fontWeight={700} mb={1}>Reports we read</Typography>
                        {ACCEPTED.map(([where, what]) => (
                            <Typography key={where} variant="body2" color="text.secondary" sx={{ lineHeight: 1.9 }}>
                                <Box component="span" fontWeight={600} color="text.primary">{where}</Box> — {what}
                            </Typography>
                        ))}
                        <Typography variant="caption" color="text.secondary" display="block" mt={1.5} sx={{ lineHeight: 1.6 }}>
                            Upload the report for the corporation&apos;s home jurisdiction. An extra-provincial registration
                            (for example, a federal corporation&apos;s Alberta search) doesn&apos;t describe the corporation itself.
                        </Typography>
                    </Paper>
                </Box>
            </Box>
        );
    }

    // ── Review ──────────────────────────────────────────────────────────
    const { report, plan, existingCompany } = preview;
    const c = report.corporation;
    const blockers = plan.flags.filter((f) => f.level === 'blocker');
    const warnings = plan.flags.filter((f) => f.level === 'warning');
    const infos = plan.flags.filter((f) => f.level === 'info');
    const stale = plan.flags.some((f) => f.code === 'stale_report');
    const alreadyHere = existingCompany?._id ?? duplicateId;
    const canCreate = !blockers.length && !alreadyHere && (!stale || staleOk) && !creating;
    const fresh = plan.reportAgeDays !== null && !stale;

    return (
        <Box sx={{ p: 3, bgcolor: '#f5f6fa', minHeight: '100vh' }}>
            <Box mb={2.5}>
                <Typography variant="h5" fontWeight={700} lineHeight={1.2}>{c.name || 'Profile report'}</Typography>
                <Box display="flex" alignItems="center" gap={1} mt={0.8} flexWrap="wrap">
                    <Typography variant="body2" color="text.secondary">
                        {report.registryName} · report dated {fmtDate(report.reportDate)}
                    </Typography>
                    {plan.reportAgeDays !== null && (
                        <Chip
                            size="small"
                            color={fresh ? 'success' : 'warning'}
                            variant="outlined"
                            label={fresh ? 'Current' : `${plan.reportAgeDays} days old`}
                        />
                    )}
                    {report.source === 'ai' && <Chip size="small" color="warning" variant="outlined" label="Read by AI — check every detail" />}
                </Box>
            </Box>

            <Box sx={{ maxWidth: 980 }}>
                {blockers.map((f, i) => <Alert key={`${f.code}-${i}`} severity="error" sx={{ mb: 1.5 }}>{f.message}</Alert>)}
                {alreadyHere && (
                    <Alert severity="info" sx={{ mb: 1.5 }}>
                        {existingCompany?.name ?? c.name} is already in your minute books.{' '}
                        <Link component={RouterLink} to={`/records/${alreadyHere}`}>Open its records</Link>
                    </Alert>
                )}
                {error && !alreadyHere && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
                {warnings.map((f, i) => <Alert key={`${f.code}-${i}`} severity="warning" sx={{ mb: 1.5 }}>{f.message}</Alert>)}
                {(blockers.length > 0 || warnings.length > 0 || alreadyHere) && <Box mb={1} />}

                <Paper elevation={0} sx={section}>
                    <Typography variant="subtitle1" fontWeight={700} mb={1.5}>Corporation</Typography>
                    <Box display="flex" flexWrap="wrap" gap={2}>
                        <Fact label="Corporation number" value={c.number} />
                        <Fact label="Business number" value={c.businessNumber} />
                        <Fact label="Incorporated" value={fmtDate(c.incorporationDate)} />
                        <Fact label="Status" value={c.status} />
                        <Fact label="Type" value={c.entityType} />
                        <Fact label="Governed by" value={GOVERNED_BY[plan.jurisdiction] ?? plan.jurisdiction} />
                        <Fact
                            label="Directors (min – max)"
                            value={c.minDirectors || c.maxDirectors ? `${c.minDirectors ?? '—'} – ${c.maxDirectors ?? '—'}` : ''}
                        />
                    </Box>
                    <Box display="flex" flexWrap="wrap" gap={2} mt={2}>
                        <Fact label="Registered office" value={fmtAddress(report.registeredOffice)} />
                        {report.recordsOffice && fmtAddress(report.recordsOffice) !== fmtAddress(report.registeredOffice) && (
                            <Fact label="Records office" value={fmtAddress(report.recordsOffice)} />
                        )}
                    </Box>
                </Paper>

                <Paper elevation={0} sx={{ ...section, overflowX: 'auto' }}>
                    <Typography variant="subtitle1" fontWeight={700} mb={1}>Directors</Typography>
                    {report.directors.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">No directors were read from this report.</Typography>
                    ) : (
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Name</TableCell>
                                    <TableCell>Address</TableCell>
                                    <TableCell>Resident Canadian</TableCell>
                                    <TableCell>Director since</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {report.directors.map((d, i) => (
                                    <TableRow key={`${d.name}-${i}`}>
                                        <TableCell><Typography variant="body2" fontWeight={600}>{d.name}</Typography></TableCell>
                                        <TableCell><Typography variant="body2">{d.address || '—'}</Typography></TableCell>
                                        <TableCell>
                                            {plan.company.directors[i]?.residentCanadian ? 'Yes' : 'No'}
                                            {d.residentCanadian === null && (
                                                <Typography variant="caption" color="text.secondary" display="block">from address — confirm</Typography>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {d.appointedDate ? fmtDate(d.appointedDate) : (
                                                <>
                                                    {fmtDate(c.incorporationDate)}
                                                    <Typography variant="caption" color="text.secondary" display="block">not on report — assumed</Typography>
                                                </>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}

                    {report.officers.length > 0 && (
                        <>
                            <Typography variant="subtitle1" fontWeight={700} mt={2.5} mb={1}>Officers</Typography>
                            {report.officers.map((o, i) => (
                                <Typography key={`${o.name}-${o.title}-${i}`} variant="body2" sx={{ lineHeight: 1.9 }}>
                                    <Box component="span" fontWeight={600}>{o.name}</Box> — {o.title}
                                    {o.appointedDate && <Box component="span" color="text.secondary"> · since {fmtDate(o.appointedDate)}</Box>}
                                </Typography>
                            ))}
                        </>
                    )}

                    {report.shareholders.length > 0 && (
                        <>
                            <Typography variant="subtitle1" fontWeight={700} mt={2.5} mb={1}>Voting shareholders on the report</Typography>
                            {report.shareholders.map((s, i) => (
                                <Typography key={`${s.name}-${i}`} variant="body2" sx={{ lineHeight: 1.9 }}>
                                    <Box component="span" fontWeight={600}>{s.name}</Box>
                                    {s.votingPercent !== null && <Box component="span" color="text.secondary"> · {s.votingPercent}% of votes</Box>}
                                </Typography>
                            ))}
                        </>
                    )}
                </Paper>

                {!blockers.length && <Paper elevation={0} sx={section}>
                    <Typography variant="subtitle1" fontWeight={700}>Records to be set up</Typography>
                    <Typography variant="body2" color="text.secondary" mb={1.5} sx={{ lineHeight: 1.6 }}>
                        Each record gets a place for its signed resolution and, where the registry was notified, its proof of filing.
                        You upload those on the Records page.
                    </Typography>
                    {plan.events.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">No dated history was read from this report.</Typography>
                    ) : plan.events.map((e, i) => (
                        <Box
                            key={`${e.eventType}-${e.effectiveDate}-${i}`}
                            display="flex" alignItems="center" justifyContent="space-between" gap={2}
                            sx={{ py: 0.9, borderTop: i ? '1px solid' : 'none', borderColor: 'divider' }}
                        >
                            <Typography variant="body2">{e.label}</Typography>
                            {!e.registryFilingNotApplicable && (
                                <Chip size="small" variant="outlined" label="Proof of filing" sx={{ flexShrink: 0 }} />
                            )}
                        </Box>
                    ))}
                </Paper>}

                {!blockers.length && infos.length > 0 && (
                    <Paper elevation={0} sx={section}>
                        <Typography variant="subtitle1" fontWeight={700} mb={1}>Before approval</Typography>
                        {infos.map((f, i) => (
                            <Typography key={`${f.code}-${i}`} variant="body2" color="text.secondary" sx={{ lineHeight: 1.7, mb: 1 }}>
                                • {f.message}
                            </Typography>
                        ))}
                    </Paper>
                )}

                {!blockers.length && !alreadyHere && (
                    <Paper elevation={0} sx={section}>
                        {firm && (
                            <FormControl sx={{ mb: 1.5, display: 'block' }}>
                                <FormLabel sx={{ fontSize: 13, fontWeight: 600, color: 'text.primary' }}>Create this company for</FormLabel>
                                <RadioGroup row value={workspace} onChange={(e) => setWorkspace(e.target.value as 'firm' | 'personal')}>
                                    <FormControlLabel value="firm" control={<Radio size="small" />} label={`${firm.name} (shared with your firm)`} />
                                    <FormControlLabel value="personal" control={<Radio size="small" />} label="Personal (only you)" />
                                </RadioGroup>
                            </FormControl>
                        )}
                        {stale && (
                            <FormControlLabel
                                sx={{ display: 'flex', mb: 1.5, alignItems: 'flex-start' }}
                                control={<Checkbox size="small" checked={staleOk} onChange={(e) => setStaleOk(e.target.checked)} sx={{ pt: 0.3 }} />}
                                label={
                                    <Typography variant="body2">
                                        I understand this report is {plan.reportAgeDays} days old and anything filed since then won&apos;t be in the book.
                                    </Typography>
                                }
                            />
                        )}
                        <Typography variant="body2" color="text.secondary" mb={2} sx={{ lineHeight: 1.6 }}>
                            The minute book starts as a draft and stays marked DRAFT until it is approved
                            {firm && workspace === 'firm' ? ' by your firm’s supervisor' : ' by a CRS reviewer'}.
                            The report PDF is kept with it.
                        </Typography>
                    </Paper>
                )}

                <Box display="flex" gap={1.5} justifyContent="flex-end" mb={4}>
                    <Button onClick={startOver} disabled={creating}>Upload a different report</Button>
                    {!blockers.length && !alreadyHere && (
                        <Button variant="contained" onClick={create} disabled={!canCreate}>
                            {creating ? 'Creating…' : 'Create draft minute book'}
                        </Button>
                    )}
                </Box>
            </Box>
        </Box>
    );
};

export default ProfileReportImport;
