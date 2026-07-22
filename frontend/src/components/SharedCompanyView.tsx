import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
    Alert, Box, Button, Chip, CircularProgress, Container, Divider, Paper, Stack, Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import BusinessIcon from '@mui/icons-material/Business';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import LandingHeader from './LandingHeader';
import LandingFooter from './LandingFooter';
import api from '../utils/api';

/**
 * Public read-only view served at /share/:token. No sign-in required —
 * the token IS the credential. Renders the shared company's directors,
 * officers, share structure, and event history; provides a one-click
 * compiled-minute-book download.
 *
 * Distinct from the authenticated app shell — this page must work for
 * users who have never touched MinuteBook, so no Layout, no Redux gates.
 */

interface Attachment {
    role: 'resolution' | 'registry_filing' | 'supporting';
    fileId: string;
    originalName: string;
    uploadedAt: string;
}

interface Event {
    _id: string;
    eventType: string;
    effectiveDate: string;
    data: Record<string, any>;
    notes?: string;
    attachments: Attachment[];
}

interface ShareResponse {
    company: any;
    events: Event[];
    share: {
        label?: string;
        expiresAt: string;
        createdAt: string;
    };
}

const EVENT_LABELS: Record<string, string> = {
    director_appointed: 'Director appointed', director_resigned: 'Director resigned',
    director_address_changed: "Director's address changed",
    address_changed: 'Registered address changed',
    shares_issued: 'Shares issued', shares_transferred: 'Shares transferred', shares_cancelled: 'Shares cancelled',
    officer_appointed: 'Officer appointed', officer_resigned: 'Officer resigned',
    share_class_added: 'Share class added',
    annual_return_filed: 'Annual return filed',
    fiscal_year_end_changed: 'Fiscal year end changed',
    name_changed: 'Company name changed',
    signing_authority_granted: 'Signing authority granted',
    signing_authority_revoked: 'Signing authority revoked',
    dividend_declared: 'Dividend declared',
};

const SharedCompanyView: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const [data, setData] = useState<ShareResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [errorStatus, setErrorStatus] = useState<null | 404 | 410 | 500>(null);
    const [downloading, setDownloading] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                // Bypass the shared axios instance's Bearer/cookie behaviour —
                // this endpoint MUST work anonymously and we don't want a
                // stale cookie confusing the request.
                const res = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/share/${token}`);
                if (res.status === 404 || res.status === 410) {
                    setErrorStatus(res.status);
                } else if (!res.ok) {
                    setErrorStatus(500);
                } else {
                    setData(await res.json());
                }
            } catch {
                setErrorStatus(500);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [token]);

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/share/${token}/minute-book`);
            if (!res.ok) throw new Error('Failed to generate.');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${(data?.company?.name || 'minute_book').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_minute_book.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            alert('Failed to download the minute book. The share link may have expired.');
        } finally {
            setDownloading(false);
        }
    };

    if (loading) {
        return (
            <Box display="flex" alignItems="center" justifyContent="center" minHeight="100vh">
                <CircularProgress />
            </Box>
        );
    }

    if (errorStatus === 404 || errorStatus === 410) {
        return (
            <Box display="flex" flexDirection="column" minHeight="100vh" bgcolor="#f5f7fa">
                <LandingHeader />
                <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center' }}>
                    <LinkOffIcon sx={{ fontSize: 56, color: 'text.disabled', mb: 2 }} />
                    <Typography variant="h5" fontWeight={700} mb={1}>
                        {errorStatus === 404 ? 'Share link not found' : 'This share link is no longer active'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {errorStatus === 404
                            ? 'Double-check the URL — or ask the person who shared it with you for a fresh link.'
                            : 'The link may have expired or been revoked by the owner. Ask them to send a new one.'}
                    </Typography>
                </Container>
                <LandingFooter />
            </Box>
        );
    }

    if (errorStatus || !data) {
        return (
            <Container sx={{ py: 8 }}>
                <Alert severity="error">Something went wrong loading this share. Please try again shortly.</Alert>
            </Container>
        );
    }

    const c = data.company;
    const activeDirectors = (c.directors || []).filter((d: any) => !d.resignedDate);
    const activeOfficers  = (c.officers  || []).filter((o: any) => !o.resignedDate);
    const activeShareholders = (c.shareholders || []).filter((s: any) => (s.numberOfShares || 0) > 0);
    const shareClasses = c.shareClasses || [];
    const expiresLabel = new Date(data.share.expiresAt).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });

    const fmtDate = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

    return (
        <Box display="flex" flexDirection="column" minHeight="100vh" bgcolor="#f5f7fa">
            <LandingHeader />

            <Box sx={{ bgcolor: '#fff8e1', borderBottom: '1px solid #ffe082', py: 1.25, px: 2, textAlign: 'center' }}>
                <Typography variant="caption" color="#8a6d1f" fontWeight={600}>
                    Read-only view · shared by owner · link expires {expiresLabel}
                    {data.share.label ? ` · "${data.share.label}"` : ''}
                </Typography>
            </Box>

            <Container maxWidth="md" sx={{ py: 4, flex: 1 }}>
                {/* Header */}
                <Paper elevation={0} sx={{ p: 3, mb: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                    <Box display="flex" alignItems="center" gap={2}>
                        <BusinessIcon sx={{ fontSize: 40, color: '#1a237e' }} />
                        <Box flex={1}>
                            <Typography variant="h5" fontWeight={700}>{c.name}</Typography>
                            <Typography variant="body2" color="text.secondary">
                                {c.corporateAccessNumber ? `CAN: ${c.corporateAccessNumber}` : ''}
                                {c.businessNumber ? ` · BN: ${c.businessNumber}` : ''}
                                {c.incorporationDate ? ` · Incorporated ${fmtDate(c.incorporationDate)}` : ''}
                            </Typography>
                        </Box>
                        <Button
                            variant="contained"
                            startIcon={downloading ? <CircularProgress size={16} sx={{ color: 'inherit' }} /> : <DownloadIcon />}
                            onClick={handleDownload}
                            disabled={downloading}
                            sx={{ fontWeight: 700, textTransform: 'none', bgcolor: '#1a237e' }}
                        >
                            {downloading ? 'Preparing…' : 'Compiled Minute Book'}
                        </Button>
                    </Box>
                </Paper>

                {/* Registered office */}
                <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                    <Typography variant="overline" color="text.secondary" fontWeight={700}>Registered office</Typography>
                    <Typography variant="body2">
                        {c.registeredOfficeAddress?.street || '—'}
                        {c.registeredOfficeAddress?.city ? `, ${c.registeredOfficeAddress.city}` : ''}
                        {c.registeredOfficeAddress?.province ? `, ${c.registeredOfficeAddress.province}` : ''}
                        {c.registeredOfficeAddress?.postalCode ? ` ${c.registeredOfficeAddress.postalCode}` : ''}
                    </Typography>
                </Paper>

                {/* Directors */}
                <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                    <Typography variant="overline" color="text.secondary" fontWeight={700}>Directors ({activeDirectors.length})</Typography>
                    {activeDirectors.length === 0 ? (
                        <Typography variant="body2" color="text.disabled">None on record.</Typography>
                    ) : (
                        <Stack spacing={0.75} mt={0.5}>
                            {activeDirectors.map((d: any, i: number) => (
                                <Box key={i} display="flex" gap={1} alignItems="baseline">
                                    <Typography variant="body2" fontWeight={600}>
                                        {[d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ') || d.name}
                                    </Typography>
                                    {d.appointedDate && <Typography variant="caption" color="text.secondary">appointed {fmtDate(d.appointedDate)}</Typography>}
                                </Box>
                            ))}
                        </Stack>
                    )}
                </Paper>

                {/* Officers */}
                {activeOfficers.length > 0 && (
                    <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                        <Typography variant="overline" color="text.secondary" fontWeight={700}>Officers ({activeOfficers.length})</Typography>
                        <Stack spacing={0.75} mt={0.5}>
                            {activeOfficers.map((o: any, i: number) => (
                                <Box key={i} display="flex" gap={1} alignItems="baseline">
                                    <Typography variant="body2" fontWeight={600}>{o.name}</Typography>
                                    <Typography variant="body2" color="text.secondary">— {o.title}</Typography>
                                </Box>
                            ))}
                        </Stack>
                    </Paper>
                )}

                {/* Share structure */}
                {shareClasses.length > 0 && (
                    <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                        <Typography variant="overline" color="text.secondary" fontWeight={700}>Share structure</Typography>
                        <Stack spacing={0.75} mt={0.5}>
                            {shareClasses.map((sc: any, i: number) => (
                                <Typography key={i} variant="body2">
                                    <strong>{sc.name}</strong> — {sc.type}
                                    {sc.voting !== undefined && `, ${sc.voting ? 'voting' : 'non-voting'}`}
                                    {sc.maxAuthorized != null && `, max ${sc.maxAuthorized.toLocaleString()}`}
                                </Typography>
                            ))}
                        </Stack>
                    </Paper>
                )}

                {/* Shareholders */}
                <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                    <Typography variant="overline" color="text.secondary" fontWeight={700}>Shareholders ({activeShareholders.length})</Typography>
                    {activeShareholders.length === 0 ? (
                        <Typography variant="body2" color="text.disabled">None on record.</Typography>
                    ) : (
                        <Stack spacing={0.75} mt={0.5}>
                            {activeShareholders.map((sh: any, i: number) => (
                                <Typography key={i} variant="body2">
                                    <strong>{sh.name}</strong> — {(sh.numberOfShares || 0).toLocaleString()} {sh.sharesClass}
                                </Typography>
                            ))}
                        </Stack>
                    )}
                </Paper>

                {/* Events */}
                <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                    <Typography variant="overline" color="text.secondary" fontWeight={700}>Recorded events ({data.events.length})</Typography>
                    {data.events.length === 0 ? (
                        <Typography variant="body2" color="text.disabled">No events recorded.</Typography>
                    ) : (
                        <Stack divider={<Divider flexItem />} spacing={1} mt={0.5}>
                            {data.events.map((ev) => (
                                <Box key={ev._id} py={0.5}>
                                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                                        <Chip label={EVENT_LABELS[ev.eventType] || ev.eventType} size="small" sx={{ height: 20, fontSize: 10.5, bgcolor: '#e8eaf6', color: '#3949ab', fontWeight: 600 }} />
                                        <Typography variant="caption" color="text.secondary">{fmtDate(ev.effectiveDate)}</Typography>
                                        {(ev.attachments?.some((a) => a.role === 'resolution')) && <Chip label="Resolution attached" size="small" sx={{ height: 18, fontSize: 9.5, bgcolor: '#e3f2fd', color: '#1565c0' }} />}
                                        {(ev.attachments?.some((a) => a.role === 'registry_filing')) && <Chip label="Registry filing attached" size="small" sx={{ height: 18, fontSize: 9.5, bgcolor: '#e8f5e9', color: '#2e7d32' }} />}
                                    </Box>
                                    {ev.notes && <Typography variant="caption" color="text.secondary" display="block" mt={0.3}>{ev.notes}</Typography>}
                                </Box>
                            ))}
                        </Stack>
                    )}
                </Paper>
            </Container>

            <LandingFooter />
        </Box>
    );
};

export default SharedCompanyView;
