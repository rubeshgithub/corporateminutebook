import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
    Box, Typography, Paper, IconButton, CircularProgress, Chip, Tooltip,
    Divider, Button, Stack, TextField,
    Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import { DocusealBuilder } from '@docuseal/react';
import SendIcon from '@mui/icons-material/Send';
import DrawIcon from '@mui/icons-material/Draw';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArchiveIcon from '@mui/icons-material/Archive';
import DownloadIcon from '@mui/icons-material/Download';
import DescriptionIcon from '@mui/icons-material/Description';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import EventIcon from '@mui/icons-material/Event';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import api from '../utils/api';
import { useSnackbar } from '../context/SnackbarContext';
import RecordEventDialog from './RecordEventDialog';
import ChangeWizard, { WizardEventType } from './ChangeWizard';
import AddIcon from '@mui/icons-material/Add';

// ─── Types ───────────────────────────────────────────────────────────────────

type EventType =
    | 'director_appointed' | 'director_resigned' | 'director_address_changed'
    | 'address_changed'
    | 'shares_issued' | 'shares_transferred' | 'shares_cancelled'
    | 'officer_appointed' | 'officer_resigned'
    | 'share_class_added'
    | 'annual_return_filed'
    | 'fiscal_year_end_changed'
    | 'name_changed'
    | 'signing_authority_granted' | 'signing_authority_revoked'
    | 'dividend_declared';

type AttachRole = 'resolution' | 'registry_filing' | 'supporting';

interface EventAttachment {
    role: AttachRole;
    fileId: string;
    originalName: string;
    uploadedAt: string;
}

interface ESign {
    submissionId?: number;
    signingUrl?: string;
    status: 'none' | 'pending' | 'completed' | 'expired';
    sentAt?: string;
}

interface CorporateEvent {
    _id: string;
    eventType: EventType;
    effectiveDate: string;
    data: Record<string, any>;
    notes?: string;
    attachments: EventAttachment[];
    eSign?: ESign;
    /** User's decision: no separate registry filing is expected for this
     *  event (e.g. founding events, provinces that don't record
     *  shareholders, or a filing rolled into another one). Compliance
     *  logic treats true as satisfied. Auto-set on founding events by
     *  the backend; togglable per-event via the UI. */
    registryFilingNotApplicable?: boolean;
}


const RESOLUTION_EVENT_TYPES = new Set<EventType>([
    'director_appointed', 'director_resigned', 'director_address_changed',
    'officer_appointed', 'officer_resigned',
    'shares_issued', 'shares_transferred', 'shares_cancelled', 'share_class_added',
    'address_changed', 'name_changed', 'fiscal_year_end_changed',
    'signing_authority_granted', 'signing_authority_revoked', 'dividend_declared',
]);

// Signing-authority and dividend events are internal governance actions —
// no separate registry filing is expected, so no "attach registry filing"
// prompt appears for them.
const REGISTRY_EVENT_TYPES = new Set<EventType>([
    'director_appointed', 'director_resigned', 'director_address_changed',
    'address_changed', 'name_changed', 'shares_transferred', 'shares_issued',
    'shares_cancelled', 'share_class_added',
]);

const EVENT_LABELS: Record<EventType, string> = {
    director_appointed: 'Director Appointed',
    director_resigned: 'Director Resigned',
    director_address_changed: "Director's Address Changed",
    address_changed: 'Registered Address Changed',
    shares_issued: 'Shares Issued',
    shares_transferred: 'Shares Transferred',
    shares_cancelled: 'Shares Cancelled',
    officer_appointed: 'Officer Appointed',
    officer_resigned: 'Officer Resigned',
    share_class_added: 'Share Class Added',
    annual_return_filed: 'Annual Return Filed',
    fiscal_year_end_changed: 'Fiscal Year End Changed',
    name_changed: 'Company Name Changed',
    signing_authority_granted: 'Signing Authority Granted',
    signing_authority_revoked: 'Signing Authority Revoked',
    dividend_declared: 'Dividend Declared',
};

const EVENT_COLORS: Record<EventType, string> = {
    director_appointed: '#1a237e',
    director_resigned: '#b71c1c',
    director_address_changed: '#4527a0',
    address_changed: '#e65100',
    shares_issued: '#1b5e20',
    shares_transferred: '#004d40',
    shares_cancelled: '#880e4f',
    officer_appointed: '#0d47a1',
    officer_resigned: '#bf360c',
    share_class_added: '#33691e',
    annual_return_filed: '#37474f',
    fiscal_year_end_changed: '#4e342e',
    name_changed: '#6a1b9a',
    signing_authority_granted: '#00695c',
    signing_authority_revoked: '#795548',
    dividend_declared: '#f9a825',
};

const ATTACH_ROLE_COLORS: Record<AttachRole, string> = {
    resolution: '#1565c0',
    registry_filing: '#2e7d32',
    supporting: '#6d4c41',
};

/**
 * Filing-status tri-state per event. Every corporate change moves through
 * three states — drafted (event logged), signed (resolution signed / e-signed),
 * filed (registry filing attached where required). Surfacing them as three
 * pills makes a lawyer or a bank compliance officer able to see, at a
 * glance, which of the three is still outstanding — instead of having to
 * cross-reference the attachment list against a mental checklist.
 */
type EventStatus = { drafted: boolean; signed: boolean; needsRegistry: boolean; filed: boolean; regNotApplicable: boolean };

const eventFilingStatus = (ev: CorporateEvent): EventStatus => {
    const resAtt = ev.attachments?.find((a) => a.role === 'resolution');
    const regAtt = ev.attachments?.find((a) => a.role === 'registry_filing');
    const eSignDone = ev.eSign?.status === 'completed';
    return {
        drafted:          true,   // the event itself is the "drafted" state
        signed:           !!resAtt || eSignDone,
        needsRegistry:    REGISTRY_EVENT_TYPES.has(ev.eventType),
        filed:            !!regAtt,
        regNotApplicable: !!ev.registryFilingNotApplicable,
    };
};

const FilingStatusPills: React.FC<{ ev: CorporateEvent }> = ({ ev }) => {
    const s = eventFilingStatus(ev);
    // Three-way pill colouring: green (satisfied), grey (pending),
    // neutral-green (N/A — satisfied but stylistically distinct so a
    // reader can see the user's choice at a glance).
    const pill = (label: string, tone: 'ok' | 'pending' | 'na', tip: string) => {
        const styles = tone === 'ok'
            ? { bg: 'rgba(46,125,50,0.10)', fg: '#2e7d32', border: 'rgba(46,125,50,0.35)' }
            : tone === 'na'
            ? { bg: 'rgba(96,125,139,0.12)', fg: '#546e7a', border: 'rgba(96,125,139,0.4)' }
            : { bg: 'rgba(158,158,158,0.15)', fg: '#616161', border: 'rgba(158,158,158,0.4)' };
        return (
            <Tooltip title={tip} arrow key={label}>
                <Chip
                    label={label}
                    size="small"
                    sx={{
                        height: 16,
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: 0.4,
                        bgcolor: styles.bg,
                        color:   styles.fg,
                        border:  '1px solid',
                        borderColor: styles.border,
                        '& .MuiChip-label': { px: 0.6 },
                        cursor: 'default',
                    }}
                />
            </Tooltip>
        );
    };
    return (
        <Box sx={{ display: 'inline-flex', gap: 0.3, ml: 0.5 }}>
            {pill('D', 'ok', 'Drafted — the event is recorded internally.')}
            {pill('S',
                s.signed ? 'ok' : 'pending',
                s.signed ? 'Signed — resolution is signed and attached.' : 'Not yet signed — upload the signed resolution or send for e-signature.',
            )}
            {s.needsRegistry && pill('F',
                s.regNotApplicable ? 'na' : s.filed ? 'ok' : 'pending',
                s.regNotApplicable
                    ? 'Registry filing marked not applicable for this event.'
                    : s.filed
                        ? 'Filed — registry filing attached.'
                        : 'Not yet filed — attach the registry acknowledgment PDF, or mark not applicable if none is expected.',
            )}
        </Box>
    );
};

const eventSummary = (type: EventType, data: Record<string, any>): string => {
    const d = data || {};
    switch (type) {
        case 'director_appointed': return [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ');
        case 'director_resigned': return d.directorName || '';
        case 'director_address_changed': return `${d.directorName || ''} → ${d.newAddress || ''}`;
        case 'address_changed': return `${d.addressType === 'registered' ? 'Registered Office' : d.addressType === 'records' ? 'Records' : 'Service'} updated`;
        case 'shares_issued': return `${d.numberOfShares} ${d.sharesClass} → ${d.name}`;
        case 'shares_transferred': return `${d.numberOfShares} ${d.sharesClass}: ${d.fromName} → ${d.toName}`;
        case 'shares_cancelled': return `${d.numberOfShares} ${d.sharesClass} cancelled from ${d.holderName}`;
        case 'officer_appointed': return `${d.name} as ${d.title}`;
        case 'officer_resigned': return d.officerName || '';
        case 'share_class_added': return d.name || '';
        case 'annual_return_filed': return `Year ${d.year || ''}${d.confirmationNumber ? ` — ${d.confirmationNumber}` : ''}`;
        case 'fiscal_year_end_changed': return `New year-end: ${d.newFiscalYearEnd || ''}`;
        case 'name_changed': return `New name: ${d.newName || ''}`;
        case 'signing_authority_granted':
            return `${d.signingOfficerName || ''}${d.title ? ` (${d.title})` : ''}${d.scope ? ` — ${d.scope}` : ''}`;
        case 'signing_authority_revoked':
            return `${d.signingOfficerName || ''}${d.reason ? ` — ${d.reason}` : ''}`;
        case 'dividend_declared': {
            const perShare = d.perShareAmount != null ? `$${Number(d.perShareAmount).toFixed(2)}/share` : '';
            const total = d.totalAmount != null ? `$${Number(d.totalAmount).toFixed(2)} total` : '';
            const cls = d.shareClass ? `${d.shareClass}` : '';
            return [cls, perShare, total].filter(Boolean).join(' · ');
        }
        default: return '';
    }
};

// ─── FYE helpers ─────────────────────────────────────────────────────────────

const parseFYE = (fye: string | undefined): [number, number] => {
    if (!fye) return [12, 31];
    const mmdd = fye.match(/^(\d{1,2})-(\d{1,2})$/);
    if (mmdd) return [parseInt(mmdd[1]), parseInt(mmdd[2])];
    const MONTHS: Record<string, number> = {
        january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
        july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
        jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const named = fye.toLowerCase().match(/([a-z]+)\s+(\d{1,2})/);
    if (named && MONTHS[named[1]]) return [MONTHS[named[1]], parseInt(named[2])];
    return [12, 31];
};

const computeExpectedFiscalYears = (
    incorporationDate: Date | undefined,
    fiscalYearEnd: string | undefined,
    today: Date,
): number[] => {
    if (!incorporationDate) return [];
    const [mm, dd] = parseFYE(fiscalYearEnd);
    const incorpYear = incorporationDate.getFullYear();
    let fye = new Date(incorpYear, mm - 1, dd);
    if (fye <= incorporationDate) {
        fye = new Date(incorpYear + 1, mm - 1, dd);
    }
    const years: number[] = [];
    while (fye < today) {
        years.push(fye.getFullYear());
        fye = new Date(fye.getFullYear() + 1, mm - 1, dd);
    }
    return years;
};

// ─── Section header ───────────────────────────────────────────────────────────

const SectionHeader: React.FC<{
    icon: React.ReactNode;
    title: string;
    chips?: React.ReactNode;
}> = ({ icon, title, chips }) => (
    <Box>
        <Box display="flex" alignItems="center" gap={1} mb={1.5}>
            {icon}
            <Typography variant="subtitle1" fontWeight={700} sx={{ flexGrow: 1 }}>
                {title}
            </Typography>
            {chips}
        </Box>
        <Divider sx={{ mb: 2 }} />
    </Box>
);

// ─── Component ───────────────────────────────────────────────────────────────

const RecordsVault: React.FC = () => {
    const { companyId } = useParams<{ companyId: string }>();
    const navigate = useNavigate();
    const { showSnackbar } = useSnackbar();

    const [company, setCompany] = useState<any>(null);
    const [events, setEvents] = useState<CorporateEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [generatingResolution, setGeneratingResolution] = useState<string | null>(null);
    const [attachDialog, setAttachDialog] = useState<{
        eventId: string;
        role: AttachRole;
        label: string;
    } | null>(null);
    const [attachFile, setAttachFile] = useState<File | null>(null);
    const [attaching, setAttaching] = useState(false);

    const [sendSigDialog, setSendSigDialog] = useState<{
        eventId: string; recipientName: string; recipientEmail: string;
    } | null>(null);
    const [sendingSig, setSendingSig] = useState(false);

    const [eSignDialog, setESignDialog] = useState<{
        eventId: string; recipientName: string; recipientEmail: string;
    } | null>(null);
    const [eSignPreviewUrl, setESignPreviewUrl] = useState<string | null>(null);
    const [eSignPreviewLoading, setESignPreviewLoading] = useState(false);
    const [eSignResult, setESignResult] = useState<{ signingUrl: string } | null>(null);
    const [checkingESignStatus, setCheckingESignStatus] = useState<string | null>(null);
    const [eSignDownloadUrls, setESignDownloadUrls] = useState<Record<string, string>>({});
    const [builderToken, setBuilderToken] = useState<string | null>(null);
    const [loadingBuilderToken, setLoadingBuilderToken] = useState(false);
    const [sendingESign, setSendingESign] = useState(false);

    const [recordEventOpen, setRecordEventOpen] = useState(false);
    // Plain-English change wizard — a tile picker that scopes the dialog to
    // the right event type before opening. Owners don't need to know what
    // `share_class_added` means; they pick "Add a new share class".
    const [wizardOpen, setWizardOpen] = useState(false);
    const [wizardPreset, setWizardPreset] = useState<WizardEventType | undefined>(undefined);
    const openWizardThenDialog = () => setWizardOpen(true);
    const handleWizardPick = (t: WizardEventType) => {
        setWizardPreset(t);
        setWizardOpen(false);
        setRecordEventOpen(true);
    };

    // Dashboard "+ Record event" fast-path passes ?openEvent=1 to bypass the
    // vault landing and open the wizard straight away. Consume + strip the
    // param so a page refresh doesn't reopen the dialog.
    const [searchParams, setSearchParams] = useSearchParams();
    useEffect(() => {
        if (searchParams.get('openEvent') === '1') {
            setWizardOpen(true);
            const next = new URLSearchParams(searchParams);
            next.delete('openEvent');
            setSearchParams(next, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const [logReturnDialog, setLogReturnDialog] = useState<{ year: number } | null>(null);
    const [logReturnDate, setLogReturnDate] = useState('');
    const [logReturnConfNum, setLogReturnConfNum] = useState('');
    const [logReturnFile, setLogReturnFile] = useState<File | null>(null);
    const [loggingReturn, setLoggingReturn] = useState(false);

    // Delete-event confirmation. Snapshot warning surfaces the honest
    // caveat: deleting the event removes it from the log + PDF compilation
    // but does NOT rewind the company snapshot (most events are lossy).
    const [deleteEventDialog, setDeleteEventDialog] = useState<{ eventId: string; label: string; summary: string; mutatesState: boolean } | null>(null);
    const [deletingEvent, setDeletingEvent] = useState(false);

    const section1Ref = useRef<HTMLDivElement>(null);
    const section2Ref = useRef<HTMLDivElement>(null);
    const section3Ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const [companyRes, eventsRes] = await Promise.all([
                    api.get(`/companies/${companyId}`),
                    api.get(`/events/${companyId}`),
                ]);
                setCompany(companyRes.data);
                setEvents(eventsRes.data);
            } catch {
                showSnackbar('Failed to load records vault.', 'error');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [companyId]);

    /**
     * Toggle the "no registry filing needed for this event" flag. Used for
     * events where the user knows a separate filing isn't expected (founding
     * events, provinces that don't record shareholders, filings rolled into
     * the incorporation itself). Backend rewrites the compliance gap count
     * as soon as this is persisted.
     */
    const handleToggleRegistryNA = async (eventId: string, next: boolean) => {
        try {
            await api.put(`/events/${eventId}`, { registryFilingNotApplicable: next });
            setEvents((prev) => prev.map((e) => e._id === eventId
                ? { ...e, registryFilingNotApplicable: next }
                : e,
            ));
            showSnackbar(next
                ? 'Marked as no registry filing needed.'
                : 'Cleared — registry filing expected.',
                'success',
            );
        } catch {
            showSnackbar('Failed to update event.', 'error');
        }
    };

    const handleConfirmDeleteEvent = async () => {
        if (!deleteEventDialog) return;
        setDeletingEvent(true);
        try {
            const res = await api.delete(`/events/${deleteEventDialog.eventId}`);
            setEvents((prev) => prev.filter((e) => e._id !== deleteEventDialog.eventId));
            setDeleteEventDialog(null);
            // Surface the snapshot warning inline (not just the ok toast) —
            // the honest version of "we removed the record but didn't rewind".
            if (res.data?.snapshotWarning && res.data?.snapshotMessage) {
                showSnackbar(res.data.snapshotMessage, 'warning');
            } else {
                showSnackbar('Event deleted.', 'success');
            }
        } catch {
            showSnackbar('Failed to delete event.', 'error');
        } finally {
            setDeletingEvent(false);
        }
    };

    const handleDownloadAttachment = async (eventId: string, fileId: string, originalName: string) => {
        try {
            const response = await api.get(`/events/${eventId}/attachment/${fileId}`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const a = document.createElement('a');
            a.href = url; a.download = originalName; a.click();
            window.URL.revokeObjectURL(url);
        } catch {
            showSnackbar('Failed to download file.', 'error');
        }
    };

    const handleDownloadIncorpDoc = async () => {
        if (!company?.incorporationDocumentFile) return;
        try {
            const response = await api.get(`/incorporation/file/${company.incorporationDocumentFile}`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${company.name}_incorporation_document.pdf`;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch {
            showSnackbar('Failed to download incorporation document.', 'error');
        }
    };

    const handleGenerateResolution = async (eventId: string) => {
        setGeneratingResolution(eventId);
        try {
            const response = await api.get(`/events/${eventId}/resolution`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `resolution_draft_${eventId}.pdf`;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch {
            showSnackbar('Failed to generate resolution draft.', 'error');
        } finally {
            setGeneratingResolution(null);
        }
    };

    const handleAttach = async () => {
        if (!attachDialog || !attachFile) return;
        setAttaching(true);
        try {
            const form = new FormData();
            form.append('file', attachFile);
            form.append('role', attachDialog.role);
            await api.post(`/events/${attachDialog.eventId}/attach`, form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const eventsRes = await api.get(`/events/${companyId}`);
            setEvents(eventsRes.data);
            setAttachDialog(null);
            setAttachFile(null);
            showSnackbar('File attached successfully.', 'success');
        } catch {
            showSnackbar('Failed to attach file.', 'error');
        } finally {
            setAttaching(false);
        }
    };

    const handleLogReturn = async () => {
        if (!logReturnDialog || !logReturnDate) return;
        setLoggingReturn(true);
        try {
            const res = await api.post('/events', {
                companyId,
                eventType: 'annual_return_filed',
                effectiveDate: logReturnDate,
                data: {
                    year: logReturnDialog.year,
                    ...(logReturnConfNum.trim() ? { confirmationNumber: logReturnConfNum.trim() } : {}),
                },
            });
            if (logReturnFile) {
                const form = new FormData();
                form.append('file', logReturnFile);
                form.append('role', 'supporting');
                await api.post(`/events/${res.data._id}/attach`, form, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
            }
            const eventsRes = await api.get(`/events/${companyId}`);
            setEvents(eventsRes.data);
            setLogReturnDialog(null);
            setLogReturnDate('');
            setLogReturnConfNum('');
            setLogReturnFile(null);
            showSnackbar(`Annual return for FY ${logReturnDialog.year} logged.`, 'success');
        } catch {
            showSnackbar('Failed to log annual return.', 'error');
        } finally {
            setLoggingReturn(false);
        }
    };

    const getRecipientSuggestion = (ev: CorporateEvent): { name: string; email: string } => {
        const d = ev.data || {};
        const dirs = company?.directors || [];
        const officers = company?.officers || [];
        const shareholders = company?.shareholders || [];

        const findDir = (name: string) => dirs.find((x: any) =>
            x.name === name ||
            [x.firstName, x.lastName].filter(Boolean).join(' ') === name
        );
        const findOfficer = (name: string) => officers.find((x: any) => x.name === name);
        const findShareholder = (name: string) => shareholders.find((x: any) => x.name === name);

        switch (ev.eventType) {
            case 'director_appointed': {
                const fullName = [d.firstName, d.lastName].filter(Boolean).join(' ');
                const dir = findDir(fullName);
                return { name: fullName, email: dir?.email || '' };
            }
            case 'director_resigned': {
                const dir = findDir(d.directorName || '');
                return { name: d.directorName || '', email: dir?.email || '' };
            }
            case 'director_address_changed': {
                const dir = findDir(d.directorName || '');
                return { name: d.directorName || '', email: dir?.email || '' };
            }
            case 'officer_appointed': {
                const off = findOfficer(d.name || '');
                return { name: d.name || '', email: off?.email || '' };
            }
            case 'officer_resigned': {
                const off = findOfficer(d.officerName || '');
                return { name: d.officerName || '', email: off?.email || '' };
            }
            case 'shares_issued': {
                const sh = findShareholder(d.name || '');
                return { name: d.name || '', email: sh?.email || '' };
            }
            case 'shares_transferred': {
                const sh = findShareholder(d.toName || '');
                return { name: d.toName || '', email: sh?.email || '' };
            }
            case 'shares_cancelled': {
                const sh = findShareholder(d.holderName || '');
                return { name: d.holderName || '', email: sh?.email || '' };
            }
            default:
                return { name: '', email: '' };
        }
    };

    const handleSendResolution = async () => {
        if (!sendSigDialog) return;
        setSendingSig(true);
        try {
            await api.post(`/events/${sendSigDialog.eventId}/send-resolution`, {
                recipientName:  sendSigDialog.recipientName,
                recipientEmail: sendSigDialog.recipientEmail,
            });
            setSendSigDialog(null);
            showSnackbar(`Resolution emailed to ${sendSigDialog.recipientEmail}.`, 'success');
        } catch {
            showSnackbar('Failed to send resolution.', 'error');
        } finally {
            setSendingSig(false);
        }
    };


    const handleLoadESignPreview = async () => {
        if (!eSignDialog) return;
        setESignPreviewLoading(true);
        try {
            const response = await api.get(`/events/${eSignDialog.eventId}/resolution`, { responseType: 'blob' });
            if (eSignPreviewUrl) window.URL.revokeObjectURL(eSignPreviewUrl);
            const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
            setESignPreviewUrl(url);
        } catch {
            showSnackbar('Failed to load document preview.', 'error');
        } finally {
            setESignPreviewLoading(false);
        }
    };

    const handleCloseESignDialog = () => {
        if (eSignPreviewUrl) { window.URL.revokeObjectURL(eSignPreviewUrl); setESignPreviewUrl(null); }
        setESignResult(null);
        setBuilderToken(null);
        setESignDialog(null);
    };

    const handleSendESign = async () => {
        if (!eSignDialog) return;
        setSendingESign(true);
        try {
            const res = await api.post(`/events/${eSignDialog.eventId}/esign`, {
                recipientName:  eSignDialog.recipientName,
                recipientEmail: eSignDialog.recipientEmail,
            });
            setESignResult({ signingUrl: res.data.signingUrl || '' });
            const eventsRes = await api.get(`/events/${companyId}`);
            setEvents(eventsRes.data);
            showSnackbar(`e-Sign request sent to ${eSignDialog.recipientEmail}.`, 'success');
        } catch {
            showSnackbar('Failed to send e-sign request.', 'error');
        } finally {
            setSendingESign(false);
        }
    };

    const handleOpenBuilder = async () => {
        if (!eSignDialog) return;
        setLoadingBuilderToken(true);
        try {
            const res = await api.post(`/events/${eSignDialog.eventId}/esign/builder-token`, {
                recipientName:  eSignDialog.recipientName,
                recipientEmail: eSignDialog.recipientEmail,
            });
            setBuilderToken(res.data.token);
        } catch {
            showSnackbar('Failed to open document builder.', 'error');
        } finally {
            setLoadingBuilderToken(false);
        }
    };

    const handleBuilderSend = async (detail: any) => {
        if (!eSignDialog) return;
        const submissionId = detail.submission_id
            || detail.submitters?.[0]?.submission_id
            || detail.submitters?.[0]?.id;
        const signingUrl = detail.submitters?.[0]?.embed_src
            || (detail.submitters?.[0]?.slug ? `https://docuseal.com/s/${detail.submitters[0].slug}` : '')
            || '';
        try {
            await api.post(`/events/${eSignDialog.eventId}/esign/record`, { submissionId, signingUrl });
            setBuilderToken(null);
            setESignResult({ signingUrl });
            const eventsRes = await api.get(`/events/${companyId}`);
            setEvents(eventsRes.data);
        } catch {
            showSnackbar('Failed to save e-sign result.', 'error');
        }
    };

    const handleEventRecorded = async (newEvent: any) => {
        setEvents((prev) => [newEvent, ...prev]);
        try {
            const updated = await api.get(`/companies/${companyId}`);
            setCompany(updated.data);
        } catch { /* company refresh is best-effort */ }
    };

    const handleCheckESignStatus = async (eventId: string) => {
        setCheckingESignStatus(eventId);
        try {
            const res = await api.get(`/events/${eventId}/esign/status`);
            const { status, downloadUrl } = res.data;
            setEvents((prev) => prev.map((ev) =>
                ev._id === eventId ? { ...ev, eSign: { ...(ev.eSign || { status: 'none' }), status } } : ev,
            ));
            if (downloadUrl) setESignDownloadUrls((prev) => ({ ...prev, [eventId]: downloadUrl }));
            if (status === 'completed') showSnackbar('Document has been signed!', 'success');
        } catch {
            showSnackbar('Failed to check e-sign status.', 'error');
        } finally {
            setCheckingESignStatus(null);
        }
    };

    // ─── Derived data ─────────────────────────────────────────────────────────

    const changeEvents = events.filter((e) => RESOLUTION_EVENT_TYPES.has(e.eventType));

    const missingResolutions = changeEvents.filter(
        (e) => !e.attachments?.some((a) => a.role === 'resolution'),
    );
    const missingRegistry = changeEvents.filter(
        (e) => REGISTRY_EVENT_TYPES.has(e.eventType)
            && !e.attachments?.some((a) => a.role === 'registry_filing')
            && !e.registryFilingNotApplicable,
    );

    const expectedFiscalYears = useMemo(() =>
        computeExpectedFiscalYears(
            company?.incorporationDate ? new Date(company.incorporationDate) : undefined,
            company?.fiscalYearEnd,
            new Date(),
        ), [company]);

    const annualReturnEvents = useMemo(() =>
        events.filter((e) => e.eventType === 'annual_return_filed'),
        [events]);

    const { filedByYear, unmatchedFilings } = useMemo(() => {
        const byYear = new Map<number, CorporateEvent>();
        const unmatched: CorporateEvent[] = [];
        for (const ev of annualReturnEvents) {
            const year = ev.data?.year != null ? Number(ev.data.year) : NaN;
            if (!isNaN(year)) byYear.set(year, ev);
            else unmatched.push(ev);
        }
        return { filedByYear: byYear, unmatchedFilings: unmatched };
    }, [annualReturnEvents]);

    const missingAnnualReturnYears = expectedFiscalYears.filter((y) => !filedByYear.has(y));
    const missingIncorpDoc = !company?.incorporationDocumentFile;

    const totalGaps = missingResolutions.length + missingRegistry.length
        + (missingIncorpDoc ? 1 : 0) + missingAnnualReturnYears.length;

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
                <CircularProgress />
            </Box>
        );
    }

    const fmtDate = (iso: string) =>
        new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    const scrollTo = (ref: React.RefObject<HTMLDivElement>) =>
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const gapChipSx = {
        fontSize: 11, cursor: 'pointer', bgcolor: '#fff3e0', color: '#e65100',
        '& .MuiChip-icon': { color: '#e65100' },
        '&:hover': { bgcolor: '#ffe0b2' },
    };

    return (
        <Box p={4} display="flex" justifyContent="center">
            <Paper elevation={3} sx={{ p: 4, width: '100%', maxWidth: 960 }}>

                {/* Header */}
                <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                    <Tooltip title="Back to Dashboard">
                        <IconButton size="small" onClick={() => navigate('/dashboard')} sx={{ mr: 0.5 }}>
                            <ArrowBackIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <ArchiveIcon color="primary" />
                    <Typography variant="h5" color="primary" fontWeight={700} flex={1}>
                        Records Vault
                    </Typography>
                    <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openWizardThenDialog}>
                        Record Event
                    </Button>
                </Box>
                <Typography variant="subtitle2" color="text.secondary" mb={3} ml={6}>
                    {company?.name}
                </Typography>

                {/* ── Compliance status bar ── */}
                {totalGaps === 0 ? (
                    <Box display="flex" alignItems="center" gap={1} mb={3} px={1.5} py={1}
                        sx={{ borderRadius: 1, bgcolor: '#f1f8e9', border: '1px solid #c5e1a5' }}>
                        <CheckCircleIcon sx={{ color: '#2e7d32', fontSize: 18 }} />
                        <Typography variant="body2" sx={{ color: '#2e7d32', fontWeight: 600 }}>
                            All records complete
                        </Typography>
                    </Box>
                ) : (
                    <Box mb={3}>
                        <Box display="flex" alignItems="center" gap={0.75} mb={1}>
                            <WarningAmberIcon sx={{ color: '#e65100', fontSize: 15 }} />
                            <Typography variant="caption" sx={{ color: '#e65100', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                {totalGaps} compliance gap{totalGaps !== 1 ? 's' : ''} — click to jump to section
                            </Typography>
                        </Box>
                        <Box display="flex" flexWrap="wrap" gap={0.75}>
                            {missingIncorpDoc && (
                                <Chip
                                    label="Incorporation document missing"
                                    size="small"
                                    icon={<WarningAmberIcon sx={{ fontSize: 13 }} />}
                                    onClick={() => scrollTo(section1Ref)}
                                    sx={gapChipSx}
                                />
                            )}
                            {missingAnnualReturnYears.length > 0 && (
                                <Chip
                                    label={`Annual returns not filed: FY ${missingAnnualReturnYears.join(', ')}`}
                                    size="small"
                                    icon={<WarningAmberIcon sx={{ fontSize: 13 }} />}
                                    onClick={() => scrollTo(section2Ref)}
                                    sx={gapChipSx}
                                />
                            )}
                            {missingResolutions.length > 0 && (
                                <Chip
                                    label={`${missingResolutions.length} resolution${missingResolutions.length !== 1 ? 's' : ''} missing`}
                                    size="small"
                                    icon={<WarningAmberIcon sx={{ fontSize: 13 }} />}
                                    onClick={() => scrollTo(section3Ref)}
                                    sx={gapChipSx}
                                />
                            )}
                            {missingRegistry.length > 0 && (
                                <Chip
                                    label={`${missingRegistry.length} registry filing${missingRegistry.length !== 1 ? 's' : ''} missing`}
                                    size="small"
                                    icon={<WarningAmberIcon sx={{ fontSize: 13 }} />}
                                    onClick={() => scrollTo(section3Ref)}
                                    sx={gapChipSx}
                                />
                            )}
                        </Box>
                    </Box>
                )}

                {/* ─── Section 1: Incorporation Documents ───────────────────── */}
                <Box ref={section1Ref}>
                    <SectionHeader
                        icon={<DescriptionIcon sx={{ fontSize: 17, color: '#1a237e' }} />}
                        title="Incorporation Documents"
                        chips={
                            missingIncorpDoc ? (
                                <Chip label="Missing" size="small" icon={<WarningAmberIcon sx={{ fontSize: 12 }} />}
                                    sx={{ bgcolor: '#fff3e0', color: '#e65100', fontSize: 10, height: 18, '& .MuiChip-icon': { color: '#e65100' } }} />
                            ) : (
                                <Chip label="Complete" size="small" icon={<CheckCircleIcon sx={{ fontSize: 12 }} />}
                                    sx={{ bgcolor: '#f1f8e9', color: '#2e7d32', fontSize: 10, height: 18, '& .MuiChip-icon': { color: '#2e7d32' } }} />
                            )
                        }
                    />

                    <Box display="flex" alignItems="center" gap={1.5} p={1.5}
                        sx={{
                            borderRadius: 1, border: '1px solid',
                            borderColor: missingIncorpDoc ? '#ffcdd2' : 'divider',
                            bgcolor: missingIncorpDoc ? '#fff8f8' : '#fafafa',
                        }}>
                        <AttachFileIcon sx={{ color: missingIncorpDoc ? '#c62828' : '#1a237e', fontSize: 20 }} />
                        <Box flex={1}>
                            <Typography variant="body2" fontWeight={600}>
                                Filed Incorporation Document
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {company?.incorporationDocumentFile
                                    ? 'Uploaded PDF — original filing'
                                    : 'Not uploaded — use the company editor to upload'}
                            </Typography>
                        </Box>
                        {company?.incorporationDocumentFile ? (
                            <Tooltip title="Download">
                                <IconButton size="small" onClick={handleDownloadIncorpDoc}>
                                    <DownloadIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        ) : (
                            <Button size="small" variant="outlined" color="warning"
                                onClick={() => navigate(`/builder/${companyId}`)}
                                sx={{ fontSize: 11, py: 0.3 }}>
                                Upload
                            </Button>
                        )}
                    </Box>

                    {company?.incorporationDate && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, pl: 0.5 }}>
                            Incorporated: {fmtDate(company.incorporationDate)}
                            {company.corporateAccessNumber ? ` · CAN: ${company.corporateAccessNumber}` : ''}
                            {company.businessNumber ? ` · BN: ${company.businessNumber}` : ''}
                        </Typography>
                    )}
                </Box>

                <Divider sx={{ my: 3.5 }} />

                {/* ─── Section 2: Annual Returns ─────────────────────────────── */}
                <Box ref={section2Ref}>
                    <SectionHeader
                        icon={<EventIcon sx={{ fontSize: 17, color: '#37474f' }} />}
                        title="Annual Returns"
                        chips={
                            expectedFiscalYears.length > 0 ? (
                                <Chip
                                    label={`${filedByYear.size + unmatchedFilings.length} / ${expectedFiscalYears.length} filed`}
                                    size="small"
                                    sx={{
                                        height: 18, fontSize: 11,
                                        bgcolor: missingAnnualReturnYears.length > 0 ? '#ffebee' : '#f1f8e9',
                                        color: missingAnnualReturnYears.length > 0 ? '#c62828' : '#33691e',
                                    }}
                                />
                            ) : (
                                <Chip label={`${annualReturnEvents.length} recorded`} size="small" sx={{ height: 18, fontSize: 11 }} />
                            )
                        }
                    />

                    {!company?.incorporationDate ? (
                        <Typography variant="body2" color="text.secondary">
                            Set incorporation date in the company editor to see expected annual returns.
                        </Typography>
                    ) : expectedFiscalYears.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                            Company incorporated less than one fiscal year ago — no annual returns expected yet.
                            {annualReturnEvents.length > 0 && ` (${annualReturnEvents.length} filing${annualReturnEvents.length > 1 ? 's' : ''} recorded early)`}
                        </Typography>
                    ) : (
                        <Box>
                            {[...expectedFiscalYears].reverse().map((year, i) => {
                                const filing = filedByYear.get(year);
                                return (
                                    <React.Fragment key={year}>
                                        {i > 0 && <Divider />}
                                        <Box display="flex" alignItems="center" gap={1.5} py={1.25} px={0.5} flexWrap="wrap">
                                            <Chip
                                                label={`FY ${year}`}
                                                size="small"
                                                sx={{ bgcolor: '#37474f', color: '#fff', fontWeight: 600, fontSize: 11, minWidth: 60, flexShrink: 0 }}
                                            />
                                            {filing ? (
                                                <>
                                                    <CheckCircleIcon sx={{ color: '#2e7d32', fontSize: 15, flexShrink: 0 }} />
                                                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 120 }}>
                                                        Filed {fmtDate(filing.effectiveDate)}
                                                        {filing.data?.confirmationNumber ? ` · Conf: ${filing.data.confirmationNumber}` : ''}
                                                    </Typography>
                                                    {filing.attachments?.length > 0 && (
                                                        <Box display="flex" gap={0.5} flexWrap="wrap">
                                                            {filing.attachments.map((att) => (
                                                                <Chip
                                                                    key={att.fileId}
                                                                    icon={<DownloadIcon sx={{ fontSize: 12 }} />}
                                                                    label={att.originalName}
                                                                    size="small"
                                                                    onClick={() => handleDownloadAttachment(filing._id, att.fileId, att.originalName)}
                                                                    sx={{ bgcolor: ATTACH_ROLE_COLORS[att.role], color: '#fff', cursor: 'pointer', fontSize: 10, '& .MuiChip-icon': { color: '#fff' } }}
                                                                />
                                                            ))}
                                                        </Box>
                                                    )}
                                                </>
                                            ) : (
                                                <>
                                                    <WarningAmberIcon sx={{ color: '#c62828', fontSize: 15, flexShrink: 0 }} />
                                                    <Typography variant="caption" sx={{ color: '#c62828', fontWeight: 600, flex: 1 }}>
                                                        Not filed
                                                    </Typography>
                                                    <Button
                                                        size="small"
                                                        variant="outlined"
                                                        color="warning"
                                                        sx={{ fontSize: 11, py: 0.2, px: 1, flexShrink: 0 }}
                                                        onClick={() => { setLogReturnDialog({ year }); setLogReturnDate(new Date().toISOString().slice(0, 10)); setLogReturnConfNum(''); setLogReturnFile(null); }}
                                                    >
                                                        Log Return
                                                    </Button>
                                                </>
                                            )}
                                        </Box>
                                    </React.Fragment>
                                );
                            })}

                            {unmatchedFilings.length > 0 && (
                                <>
                                    <Divider sx={{ my: 1 }} />
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pb: 0.75, pl: 0.5 }}>
                                        Filings without a fiscal year — edit the event to assign one:
                                    </Typography>
                                    {unmatchedFilings.map((ev, i) => (
                                        <React.Fragment key={ev._id}>
                                            {i > 0 && <Divider />}
                                            <Box display="flex" alignItems="center" gap={1.5} py={1} px={0.5}>
                                                <Chip label="Year unknown" size="small" sx={{ bgcolor: '#78909c', color: '#fff', fontSize: 11, flexShrink: 0 }} />
                                                <Typography variant="caption" color="text.secondary">
                                                    Filed {fmtDate(ev.effectiveDate)}
                                                    {ev.data?.confirmationNumber ? ` · Conf: ${ev.data.confirmationNumber}` : ''}
                                                </Typography>
                                            </Box>
                                        </React.Fragment>
                                    ))}
                                </>
                            )}

                            {company?.annualReturnDueDate && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pt: 1.5, pl: 0.5 }}>
                                    Annual return due: {company.annualReturnDueDate} each year
                                </Typography>
                            )}
                        </Box>
                    )}
                </Box>

                <Divider sx={{ my: 3.5 }} />

                {/* ─── Section 3: Corporate Changes Archive ─────────────────── */}
                <Box ref={section3Ref}>
                    <SectionHeader
                        icon={<AttachFileIcon sx={{ fontSize: 17, color: '#4527a0' }} />}
                        title="Corporate Changes Archive"
                        chips={
                            <>
                                <Chip label={changeEvents.length} size="small" sx={{ height: 18, fontSize: 11 }} />
                                {(missingResolutions.length > 0 || missingRegistry.length > 0) && (
                                    <Chip
                                        label={`${missingResolutions.length + missingRegistry.length} gap${missingResolutions.length + missingRegistry.length !== 1 ? 's' : ''}`}
                                        size="small"
                                        icon={<WarningAmberIcon sx={{ fontSize: 12 }} />}
                                        sx={{ bgcolor: '#fff3e0', color: '#e65100', fontSize: 10, height: 18, '& .MuiChip-icon': { color: '#e65100' } }}
                                    />
                                )}
                            </>
                        }
                    />

                    {changeEvents.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                            No corporate change events recorded yet.
                        </Typography>
                    ) : (
                        <Stack spacing={1.5}>
                            {changeEvents.map((ev) => {
                                const resAtt = ev.attachments?.find((a) => a.role === 'resolution');
                                const regAtt = ev.attachments?.find((a) => a.role === 'registry_filing');
                                const needsRegistry = REGISTRY_EVENT_TYPES.has(ev.eventType);
                                const missingRes = RESOLUTION_EVENT_TYPES.has(ev.eventType) && !resAtt;
                                const missingReg = needsRegistry && !regAtt;
                                return (
                                    <Box key={ev._id} p={1.5}
                                        sx={{
                                            borderRadius: 1, border: '1px solid',
                                            borderColor: (missingRes || missingReg) ? '#ffe082' : 'divider',
                                            bgcolor: (missingRes || missingReg) ? '#fffde7' : '#fafafa',
                                        }}
                                    >
                                        {/* Event header */}
                                        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mb={1}>
                                            <Chip
                                                label={EVENT_LABELS[ev.eventType]}
                                                size="small"
                                                sx={{ bgcolor: EVENT_COLORS[ev.eventType] || 'primary.main', color: '#fff', fontWeight: 600, fontSize: 10 }}
                                            />
                                            <Typography variant="caption" color="text.secondary">
                                                {fmtDate(ev.effectiveDate)}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {eventSummary(ev.eventType, ev.data)}
                                            </Typography>
                                            {ev.notes === 'Founding' && (
                                                <Chip label="Founding" size="small" sx={{ bgcolor: '#e8eaf6', color: '#3949ab', fontSize: 10, height: 18 }} />
                                            )}
                                            <FilingStatusPills ev={ev} />
                                            <Box sx={{ ml: 'auto' }}>
                                                <Tooltip title="Delete event">
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => setDeleteEventDialog({
                                                            eventId: ev._id,
                                                            label: EVENT_LABELS[ev.eventType],
                                                            summary: eventSummary(ev.eventType, ev.data),
                                                            mutatesState: RESOLUTION_EVENT_TYPES.has(ev.eventType),
                                                        })}
                                                        sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                                                    >
                                                        <DeleteOutlineIcon sx={{ fontSize: 15 }} />
                                                    </IconButton>
                                                </Tooltip>
                                            </Box>
                                        </Box>

                                        {/* Resolution row */}
                                        {RESOLUTION_EVENT_TYPES.has(ev.eventType) && (
                                            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mb={0.5}
                                                sx={{ pl: 0.5, borderLeft: '3px solid #1565c0' }}>
                                                <Typography variant="caption" sx={{ color: '#1565c0', fontWeight: 700, minWidth: 80 }}>
                                                    Resolution
                                                </Typography>
                                                <Tooltip title="Download resolution draft PDF">
                                                    <Button
                                                        size="small"
                                                        variant="outlined"
                                                        startIcon={generatingResolution === ev._id
                                                            ? <CircularProgress size={11} />
                                                            : <AutorenewIcon sx={{ fontSize: 13 }} />}
                                                        disabled={generatingResolution === ev._id}
                                                        onClick={() => handleGenerateResolution(ev._id)}
                                                        sx={{ fontSize: 10, py: 0.2, px: 1, color: '#1565c0', borderColor: '#1565c0' }}
                                                    >
                                                        Generate Draft
                                                    </Button>
                                                </Tooltip>
                                                {resAtt ? (
                                                    <Chip
                                                        icon={<DownloadIcon sx={{ fontSize: 13 }} />}
                                                        label={`Signed: ${resAtt.originalName}`}
                                                        size="small"
                                                        onClick={() => handleDownloadAttachment(ev._id, resAtt.fileId, resAtt.originalName)}
                                                        sx={{ bgcolor: ATTACH_ROLE_COLORS.resolution, color: '#fff', cursor: 'pointer', fontSize: 10, maxWidth: 260, '& .MuiChip-icon': { color: '#fff' } }}
                                                    />
                                                ) : (
                                                    <>
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            color="warning"
                                                            startIcon={<AttachFileIcon sx={{ fontSize: 13 }} />}
                                                            onClick={() => { setAttachDialog({ eventId: ev._id, role: 'resolution', label: 'Signed Resolution' }); setAttachFile(null); }}
                                                            sx={{ fontSize: 10, py: 0.2, px: 1 }}
                                                        >
                                                            Upload Signed
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            startIcon={<SendIcon sx={{ fontSize: 13 }} />}
                                                            onClick={() => {
                                                                const s = getRecipientSuggestion(ev);
                                                                setSendSigDialog({ eventId: ev._id, recipientName: s.name, recipientEmail: s.email });
                                                            }}
                                                            sx={{ fontSize: 10, py: 0.2, px: 1, color: '#1a237e', borderColor: '#1a237e' }}
                                                        >
                                                            Send
                                                        </Button>
                                                        {(!ev.eSign?.status || ev.eSign.status === 'none' || ev.eSign.status === 'expired') && (
                                                            <Button
                                                                size="small"
                                                                variant="outlined"
                                                                startIcon={<SendIcon sx={{ fontSize: 13 }} />}
                                                                onClick={() => {
                                                                    const s = getRecipientSuggestion(ev);
                                                                    setESignDialog({ eventId: ev._id, recipientName: s.name, recipientEmail: s.email });
                                                                }}
                                                                sx={{ fontSize: 10, py: 0.2, px: 1, color: '#6a1b9a', borderColor: '#6a1b9a' }}
                                                            >
                                                                e-Sign
                                                            </Button>
                                                        )}
                                                    </>
                                                )}
                                                {ev.eSign?.status === 'pending' && (
                                                    <>
                                                        <Chip
                                                            label="Pending Signature"
                                                            size="small"
                                                            sx={{ bgcolor: '#fff8e1', color: '#f57f17', fontSize: 10, height: 20, fontWeight: 600 }}
                                                        />
                                                        <Tooltip title="Refresh signing status">
                                                            <IconButton
                                                                size="small"
                                                                disabled={checkingESignStatus === ev._id}
                                                                onClick={() => handleCheckESignStatus(ev._id)}
                                                            >
                                                                {checkingESignStatus === ev._id
                                                                    ? <CircularProgress size={12} />
                                                                    : <AutorenewIcon sx={{ fontSize: 14 }} />}
                                                            </IconButton>
                                                        </Tooltip>
                                                    </>
                                                )}
                                                {ev.eSign?.status === 'completed' && (
                                                    <>
                                                        <Chip
                                                            label="Signed ✓"
                                                            size="small"
                                                            sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontSize: 10, height: 20, fontWeight: 600 }}
                                                        />
                                                        {eSignDownloadUrls[ev._id] ? (
                                                            <Button
                                                                size="small"
                                                                variant="outlined"
                                                                startIcon={<DownloadIcon sx={{ fontSize: 13 }} />}
                                                                onClick={() => window.open(eSignDownloadUrls[ev._id], '_blank')}
                                                                sx={{ fontSize: 10, py: 0.2, px: 1, color: '#2e7d32', borderColor: '#2e7d32' }}
                                                            >
                                                                Download Signed
                                                            </Button>
                                                        ) : (
                                                            <Tooltip title="Fetch signed document link">
                                                                <IconButton
                                                                    size="small"
                                                                    disabled={checkingESignStatus === ev._id}
                                                                    onClick={() => handleCheckESignStatus(ev._id)}
                                                                >
                                                                    {checkingESignStatus === ev._id
                                                                        ? <CircularProgress size={12} />
                                                                        : <DownloadIcon sx={{ fontSize: 14 }} />}
                                                                </IconButton>
                                                            </Tooltip>
                                                        )}
                                                    </>
                                                )}
                                                {ev.eSign?.status === 'expired' && (
                                                    <Chip
                                                        label="e-Sign Expired"
                                                        size="small"
                                                        sx={{ bgcolor: '#ffebee', color: '#c62828', fontSize: 10, height: 20 }}
                                                    />
                                                )}
                                            </Box>
                                        )}

                                        {/* Registry filing row.
                                            Three states:
                                              1. Filed — chip with download link.
                                              2. Not applicable — user marked this event as needing
                                                 no separate filing (founding / no-record province /
                                                 rolled into another filing). Chip + "Undo" affordance.
                                              3. Pending — Upload button + "Mark N/A" affordance.
                                            The N/A path is the fix for the case where the compliance
                                            chip shows a gap that isn't actually a gap. */}
                                        {needsRegistry && (
                                            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap"
                                                sx={{ pl: 0.5, borderLeft: '3px solid #2e7d32' }}>
                                                <Typography variant="caption" sx={{ color: '#2e7d32', fontWeight: 700, minWidth: 80 }}>
                                                    Registry
                                                </Typography>
                                                {regAtt ? (
                                                    <Chip
                                                        icon={<DownloadIcon sx={{ fontSize: 13 }} />}
                                                        label={`Filed: ${regAtt.originalName}`}
                                                        size="small"
                                                        onClick={() => handleDownloadAttachment(ev._id, regAtt.fileId, regAtt.originalName)}
                                                        sx={{ bgcolor: ATTACH_ROLE_COLORS.registry_filing, color: '#fff', cursor: 'pointer', fontSize: 10, maxWidth: 260, '& .MuiChip-icon': { color: '#fff' } }}
                                                    />
                                                ) : ev.registryFilingNotApplicable ? (
                                                    <>
                                                        <Chip
                                                            label="Not applicable"
                                                            size="small"
                                                            sx={{ bgcolor: '#eceff1', color: '#546e7a', fontSize: 10, height: 20, fontWeight: 600 }}
                                                        />
                                                        <Button
                                                            size="small"
                                                            variant="text"
                                                            onClick={() => handleToggleRegistryNA(ev._id, false)}
                                                            sx={{ fontSize: 10, py: 0.2, px: 0.6, color: 'text.secondary', minWidth: 0 }}
                                                        >
                                                            Undo
                                                        </Button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            color="warning"
                                                            startIcon={<AttachFileIcon sx={{ fontSize: 13 }} />}
                                                            onClick={() => { setAttachDialog({ eventId: ev._id, role: 'registry_filing', label: 'Registry Filing Confirmation' }); setAttachFile(null); }}
                                                            sx={{ fontSize: 10, py: 0.2, px: 1 }}
                                                        >
                                                            Upload Filing
                                                        </Button>
                                                        <Tooltip title="No separate registry filing is expected for this event (e.g. founding events, or provinces that don't record it).">
                                                            <Button
                                                                size="small"
                                                                variant="text"
                                                                onClick={() => handleToggleRegistryNA(ev._id, true)}
                                                                sx={{ fontSize: 10, py: 0.2, px: 0.6, color: 'text.secondary', minWidth: 0 }}
                                                            >
                                                                Mark N/A
                                                            </Button>
                                                        </Tooltip>
                                                    </>
                                                )}
                                            </Box>
                                        )}

                                        {/* Specimen-signature nudge for signing-authority grants — banks
                                            typically want the resolution paired with a specimen signature
                                            card. The template already has the placeholder box; this
                                            surfaces the "attach the signed card" affordance so the owner
                                            doesn't have to hunt for the generic supporting-file upload. */}
                                        {ev.eventType === 'signing_authority_granted' && (() => {
                                            const supAtt = ev.attachments?.find((a) => a.role === 'supporting');
                                            return (
                                                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mb={0.5}
                                                    sx={{ pl: 0.5, borderLeft: '3px solid #00695c' }}>
                                                    <Typography variant="caption" sx={{ color: '#00695c', fontWeight: 700, minWidth: 80 }}>
                                                        Specimen sig.
                                                    </Typography>
                                                    {supAtt ? (
                                                        <Chip
                                                            icon={<DownloadIcon sx={{ fontSize: 13 }} />}
                                                            label={supAtt.originalName}
                                                            size="small"
                                                            onClick={() => handleDownloadAttachment(ev._id, supAtt.fileId, supAtt.originalName)}
                                                            sx={{ bgcolor: ATTACH_ROLE_COLORS.supporting, color: '#fff', cursor: 'pointer', fontSize: 10, maxWidth: 260, '& .MuiChip-icon': { color: '#fff' } }}
                                                        />
                                                    ) : (
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            startIcon={<AttachFileIcon sx={{ fontSize: 13 }} />}
                                                            onClick={() => { setAttachDialog({ eventId: ev._id, role: 'supporting', label: 'Specimen Signature Card' }); setAttachFile(null); }}
                                                            sx={{ fontSize: 10, py: 0.2, px: 1, color: '#00695c', borderColor: '#00695c' }}
                                                        >
                                                            Attach Card
                                                        </Button>
                                                    )}
                                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9.5 }}>
                                                        Banks require a signature card for signing officers.
                                                    </Typography>
                                                </Box>
                                            );
                                        })()}
                                    </Box>
                                );
                            })}
                        </Stack>
                    )}
                </Box>

            </Paper>

            {/* ── Log Annual Return Dialog ── */}
            <Dialog
                open={!!logReturnDialog}
                onClose={() => setLogReturnDialog(null)}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>Log Annual Return — FY {logReturnDialog?.year}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} pt={1}>
                        <TextField
                            label="Date filed"
                            type="date"
                            size="small"
                            fullWidth
                            required
                            value={logReturnDate}
                            onChange={(e) => setLogReturnDate(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                        <TextField
                            label="Confirmation number (optional)"
                            size="small"
                            fullWidth
                            value={logReturnConfNum}
                            onChange={(e) => setLogReturnConfNum(e.target.value)}
                            placeholder="e.g. AR-2024-123456"
                        />
                        <Button
                            variant={logReturnFile ? 'contained' : 'outlined'}
                            component="label"
                            startIcon={<AttachFileIcon />}
                            color={logReturnFile ? 'success' : 'primary'}
                            sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                        >
                            {logReturnFile ? logReturnFile.name : 'Attach filing document (optional)'}
                            <input
                                type="file"
                                hidden
                                accept="application/pdf,.pdf,.png,.jpg,.jpeg"
                                onChange={(e) => setLogReturnFile(e.target.files?.[0] || null)}
                            />
                        </Button>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setLogReturnDialog(null)}>Cancel</Button>
                    <Button
                        variant="contained"
                        disabled={!logReturnDate || loggingReturn}
                        startIcon={loggingReturn ? <CircularProgress size={16} /> : undefined}
                        onClick={handleLogReturn}
                    >
                        Save
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ── e-Sign Dialog (DocuSeal) ── */}
            <Dialog
                open={!!eSignDialog}
                onClose={handleCloseESignDialog}
                fullScreen={!!builderToken}
                maxWidth={builderToken ? false : (eSignPreviewUrl ? 'md' : 'xs')}
                fullWidth={!builderToken}
            >
                <DialogTitle sx={builderToken ? { py: 1, borderBottom: '1px solid', borderColor: 'divider' } : {}}>
                    {builderToken
                        ? 'Place Signature Fields & Send'
                        : eSignResult
                            ? 'e-Sign Request Sent'
                            : 'Send for e-Signature via DocuSeal'}
                </DialogTitle>

                <DialogContent sx={builderToken ? { p: 0, display: 'flex', flexDirection: 'column' } : {}}>
                    {builderToken ? (
                        <DocusealBuilder
                            token={builderToken}
                            onSend={handleBuilderSend}
                            withSendButton
                        />
                    ) : eSignResult ? (
                        <Stack spacing={2} pt={1}>
                            <Typography variant="body2" color="success.main" fontWeight={600}>
                                DocuSeal will email {eSignDialog?.recipientEmail} a secure signing link.
                            </Typography>
                            {eSignResult.signingUrl && (
                                <Box>
                                    <Typography variant="caption" color="text.secondary">
                                        Signing link — share via other channels if needed:
                                    </Typography>
                                    <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                                        <TextField
                                            size="small"
                                            fullWidth
                                            value={eSignResult.signingUrl}
                                            InputProps={{ readOnly: true }}
                                            sx={{ '& input': { fontSize: 11 } }}
                                        />
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            sx={{ flexShrink: 0 }}
                                            onClick={() => {
                                                navigator.clipboard.writeText(eSignResult.signingUrl);
                                                showSnackbar('Signing link copied!', 'success');
                                            }}
                                        >
                                            Copy
                                        </Button>
                                    </Box>
                                </Box>
                            )}
                        </Stack>
                    ) : (
                        <Stack spacing={2} pt={1}>
                            <Typography variant="body2" color="text.secondary">
                                Fill in the recipient, then open the builder to visually place signature fields on the document before sending.
                            </Typography>
                            <TextField
                                label="Recipient name"
                                size="small"
                                fullWidth
                                value={eSignDialog?.recipientName || ''}
                                onChange={(e) => setESignDialog((prev) => prev ? { ...prev, recipientName: e.target.value } : null)}
                            />
                            <TextField
                                label="Recipient email"
                                type="email"
                                size="small"
                                fullWidth
                                value={eSignDialog?.recipientEmail || ''}
                                onChange={(e) => setESignDialog((prev) => prev ? { ...prev, recipientEmail: e.target.value } : null)}
                            />
                            <Button
                                size="small"
                                variant="outlined"
                                startIcon={eSignPreviewLoading
                                    ? <CircularProgress size={13} />
                                    : <DescriptionIcon sx={{ fontSize: 14 }} />}
                                disabled={eSignPreviewLoading}
                                onClick={handleLoadESignPreview}
                                sx={{ alignSelf: 'flex-start' }}
                            >
                                {eSignPreviewUrl ? 'Reload Preview' : 'Preview Document'}
                            </Button>
                            {eSignPreviewUrl && (
                                <Box sx={{ height: 480, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                                    <iframe
                                        src={eSignPreviewUrl}
                                        style={{ width: '100%', height: '100%', border: 'none' }}
                                        title="Resolution Preview"
                                    />
                                </Box>
                            )}
                        </Stack>
                    )}
                </DialogContent>

                <DialogActions>
                    {builderToken ? (
                        <Button onClick={() => setBuilderToken(null)}>← Back</Button>
                    ) : eSignResult ? (
                        <Button onClick={handleCloseESignDialog}>Done</Button>
                    ) : (
                        <>
                            <Button onClick={handleCloseESignDialog}>Cancel</Button>
                            <Button
                                variant="outlined"
                                disabled={!eSignDialog?.recipientEmail || loadingBuilderToken || sendingESign}
                                startIcon={loadingBuilderToken
                                    ? <CircularProgress size={16} color="inherit" />
                                    : <DrawIcon />}
                                onClick={handleOpenBuilder}
                            >
                                {loadingBuilderToken ? 'Loading…' : 'Customize Fields'}
                            </Button>
                            <Button
                                variant="contained"
                                disabled={!eSignDialog?.recipientEmail || sendingESign || loadingBuilderToken}
                                startIcon={sendingESign ? <CircularProgress size={16} color="inherit" /> : undefined}
                                onClick={handleSendESign}
                            >
                                {sendingESign ? 'Sending…' : 'Send for e-Sign'}
                            </Button>
                        </>
                    )}
                </DialogActions>
            </Dialog>

            {/* ── Send for Signature Dialog ── */}
            <Dialog open={!!sendSigDialog} onClose={() => setSendSigDialog(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Send Resolution for Signature</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} pt={1}>
                        <TextField
                            label="Recipient name"
                            size="small"
                            fullWidth
                            value={sendSigDialog?.recipientName || ''}
                            onChange={(e) => setSendSigDialog((prev) => prev ? { ...prev, recipientName: e.target.value } : null)}
                        />
                        <TextField
                            label="Recipient email"
                            type="email"
                            size="small"
                            fullWidth
                            value={sendSigDialog?.recipientEmail || ''}
                            onChange={(e) => setSendSigDialog((prev) => prev ? { ...prev, recipientEmail: e.target.value } : null)}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSendSigDialog(null)}>Cancel</Button>
                    <Button
                        variant="contained"
                        disabled={!sendSigDialog?.recipientEmail || sendingSig}
                        startIcon={sendingSig ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
                        onClick={handleSendResolution}
                    >
                        {sendingSig ? 'Sending…' : 'Send'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ── Inline Attach Dialog ── */}
            <Dialog
                open={!!attachDialog}
                onClose={() => { setAttachDialog(null); setAttachFile(null); }}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>Attach {attachDialog?.label}</DialogTitle>
                <DialogContent>
                    <Box pt={1} display="flex" flexDirection="column" gap={2}>
                        <Typography variant="body2" color="text.secondary">
                            Upload the signed or official {attachDialog?.label?.toLowerCase()} document (PDF).
                        </Typography>
                        <Button
                            variant={attachFile ? 'contained' : 'outlined'}
                            component="label"
                            startIcon={<AttachFileIcon />}
                            color={attachFile ? 'success' : 'primary'}
                            sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                        >
                            {attachFile ? attachFile.name : 'Choose file…'}
                            <input
                                type="file"
                                hidden
                                accept="application/pdf,.pdf,.png,.jpg,.jpeg"
                                onChange={(e) => setAttachFile(e.target.files?.[0] || null)}
                            />
                        </Button>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => { setAttachDialog(null); setAttachFile(null); }}>Cancel</Button>
                    <Button
                        variant="contained"
                        disabled={!attachFile || attaching}
                        startIcon={attaching ? <CircularProgress size={16} /> : <AttachFileIcon />}
                        onClick={handleAttach}
                    >
                        Attach
                    </Button>
                </DialogActions>
            </Dialog>

            <ChangeWizard
                open={wizardOpen}
                onClose={() => setWizardOpen(false)}
                onPick={handleWizardPick}
            />

            <RecordEventDialog
                open={recordEventOpen}
                onClose={() => { setRecordEventOpen(false); setWizardPreset(undefined); }}
                companyId={companyId!}
                company={company}
                onSuccess={handleEventRecorded}
                initialEventType={wizardPreset}
            />

            {/* Delete-event confirmation. The snapshot caveat is up-front:
                the event is dropped from the log + PDF compilation, but the
                company snapshot (directors, shareholders, etc.) is not
                automatically rewound because most events are lossy. */}
            <Dialog
                open={!!deleteEventDialog}
                onClose={() => !deletingEvent && setDeleteEventDialog(null)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Delete event</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" mb={1.5}>
                        Delete this event from the record?
                    </Typography>
                    {deleteEventDialog && (
                        <Box sx={{ p: 1.5, bgcolor: '#f5f5f5', borderRadius: 1, mb: 2 }}>
                            <Typography variant="caption" fontWeight={700} color="text.secondary" textTransform="uppercase" letterSpacing={0.5} display="block">
                                {deleteEventDialog.label}
                            </Typography>
                            <Typography variant="body2">{deleteEventDialog.summary}</Typography>
                        </Box>
                    )}
                    {deleteEventDialog?.mutatesState && (
                        <Box sx={{ p: 1.5, bgcolor: '#fff8e1', border: '1px solid #ffe082', borderRadius: 1, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                            <WarningAmberIcon sx={{ color: '#f57f17', fontSize: 18, mt: 0.25, flexShrink: 0 }} />
                            <Typography variant="caption" color="#8a6d1f" lineHeight={1.55}>
                                <strong>Snapshot won&apos;t rewind automatically.</strong> The event will be removed from the log, resolutions, and compiled minute book — but the company&apos;s current directors, shareholders, share structure, or address will stay as they are. If this deletion should also change the company state, use the company editor.
                            </Typography>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteEventDialog(null)} disabled={deletingEvent}>Cancel</Button>
                    <Button
                        onClick={handleConfirmDeleteEvent}
                        color="error"
                        variant="contained"
                        disabled={deletingEvent}
                        startIcon={deletingEvent ? <CircularProgress size={16} /> : <DeleteOutlineIcon />}
                    >
                        Delete event
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default RecordsVault;
