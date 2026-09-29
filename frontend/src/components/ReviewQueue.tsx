import React, { useCallback, useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Button, Alert, CircularProgress, TextField,
    Table, TableBody, TableCell, TableHead, TableRow,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import api from '../utils/api';
import { useSnackbar } from '../context/SnackbarContext';

interface QueueItem {
    _id: string;
    name: string;
    corporateAccessNumber?: string;
    businessNumber?: string;
    province?: string;
    owner: { name?: string; email?: string };
    submittedAt?: string;
    note?: string;
}

type Decision = 'approve' | 'request-changes';

const formatDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

/**
 * CRS review queue — business owners' minute books submitted for approval,
 * oldest first. Firm books never appear here; their supervisors approve them.
 */
const ReviewQueue: React.FC = () => {
    const { showSnackbar } = useSnackbar();
    const [items, setItems] = useState<QueueItem[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [previewing, setPreviewing] = useState<string | null>(null);
    const [decision, setDecision] = useState<{ item: QueueItem; kind: Decision } | null>(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const { data } = await api.get<QueueItem[]>('/reviews');
            setItems(data);
            setLoadError(null);
        } catch (err: any) {
            setLoadError(err?.response?.status === 403
                ? 'Only CRS reviewers can see the review queue.'
                : 'The review queue could not be loaded.');
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const preview = async (item: QueueItem) => {
        setPreviewing(item._id);
        try {
            const res = await api.post(`/reviews/${item._id}/minute-book`, {}, { responseType: 'blob' });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            window.open(url, '_blank', 'noopener');
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch {
            showSnackbar('Could not compile the minute book for review.', 'error');
        } finally {
            setPreviewing(null);
        }
    };

    const decide = async () => {
        if (!decision) return;
        setBusy(true);
        try {
            await api.post(`/companies/${decision.item._id}/approval/${decision.kind}`, note.trim() ? { note: note.trim() } : {});
            showSnackbar(
                decision.kind === 'approve'
                    ? `${decision.item.name} approved. The owner has been notified.`
                    : `${decision.item.name} sent back to the owner.`,
                'success',
            );
            setDecision(null);
            setNote('');
            await load();
        } catch (err: any) {
            showSnackbar(err?.response?.data?.error || 'That did not work. Please try again.', 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box sx={{ p: 3, bgcolor: '#f5f6fa', minHeight: '100vh' }}>
            <Box mb={2.5}>
                <Typography variant="h5" fontWeight={700} lineHeight={1.2}>Review queue</Typography>
                <Typography variant="body2" color="text.secondary" mt={0.3}>
                    Business owners&apos; minute books waiting for CRS approval, oldest first
                </Typography>
            </Box>

            {loadError && <Alert severity="error" sx={{ mb: 2.5 }}>{loadError}</Alert>}

            {!items && !loadError && (
                <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
            )}

            {items && (
                <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'white', overflowX: 'auto' }}>
                    {items.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" p={3}>Nothing is waiting for review.</Typography>
                    ) : (
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Corporation</TableCell>
                                    <TableCell>Owner</TableCell>
                                    <TableCell>Submitted</TableCell>
                                    <TableCell align="right" />
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {items.map((item) => (
                                    <TableRow key={item._id}>
                                        <TableCell>
                                            <Typography variant="body2" fontWeight={600}>{item.name}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {[item.province, item.corporateAccessNumber || item.businessNumber].filter(Boolean).join(' · ') || '—'}
                                            </Typography>
                                            {item.note && (
                                                <Typography variant="caption" display="block" color="text.secondary" mt={0.5}>
                                                    Owner&apos;s note: {item.note}
                                                </Typography>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2">{item.owner.name || '—'}</Typography>
                                            <Typography variant="caption" color="text.secondary">{item.owner.email}</Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2">{formatDate(item.submittedAt)}</Typography>
                                        </TableCell>
                                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                            <Box display="flex" gap={1} justifyContent="flex-end">
                                                <Button size="small" disabled={previewing === item._id} onClick={() => preview(item)}>
                                                    {previewing === item._id ? 'Compiling…' : 'Preview book'}
                                                </Button>
                                                <Button size="small" color="warning" onClick={() => { setNote(''); setDecision({ item, kind: 'request-changes' }); }}>
                                                    Request changes
                                                </Button>
                                                <Button size="small" variant="contained" color="success" onClick={() => { setNote(''); setDecision({ item, kind: 'approve' }); }}>
                                                    Approve
                                                </Button>
                                            </Box>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </Paper>
            )}

            <Dialog open={!!decision} onClose={() => !busy && setDecision(null)} maxWidth="sm" fullWidth>
                <DialogTitle>
                    {decision?.kind === 'approve' ? `Approve ${decision.item.name}` : `Send ${decision?.item.name} back`}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText mb={2}>
                        {decision?.kind === 'approve'
                            ? 'The DRAFT watermark comes off the compiled book and the owner is emailed.'
                            : 'The owner is emailed your note and can resubmit after making changes.'}
                    </DialogContentText>
                    <TextField
                        fullWidth
                        multiline
                        minRows={2}
                        label={decision?.kind === 'approve' ? 'Note for the owner (optional)' : 'What needs to change'}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        inputProps={{ maxLength: 2000 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDecision(null)} disabled={busy}>Cancel</Button>
                    <Button
                        variant="contained"
                        color={decision?.kind === 'approve' ? 'success' : 'warning'}
                        disabled={busy || (decision?.kind === 'request-changes' && !note.trim())}
                        onClick={decide}
                    >
                        {decision?.kind === 'approve' ? 'Approve' : 'Send back'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default ReviewQueue;
