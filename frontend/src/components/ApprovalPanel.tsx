import React, { useState } from 'react';
import {
    Box, Typography, Button, Chip, Alert, TextField,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import VerifiedIcon from '@mui/icons-material/Verified';
import { useSelector } from 'react-redux';
import api from '../utils/api';
import { useSnackbar } from '../context/SnackbarContext';

type Status = 'draft' | 'submitted' | 'changes_requested' | 'approved';
type Action = 'submit' | 'approve' | 'request-changes' | 'reopen';

export interface Approval {
    status?: Status;
    submittedAt?: string | null;
    reviewedAt?: string | null;
    note?: string;
}

const STATUS_CHIP: Record<Status, { label: string; bg: string; color: string }> = {
    draft:             { label: 'Draft',             bg: '#eceff1', color: '#455a64' },
    submitted:         { label: 'In review',         bg: '#e3f2fd', color: '#1565c0' },
    changes_requested: { label: 'Changes requested', bg: '#fff3e0', color: '#e65100' },
    approved:          { label: 'Approved',          bg: '#e8f5e9', color: '#2e7d32' },
};

const DIALOG: Record<Action, { title: string; body: string; confirm: string; noteLabel: string; noteRequired: boolean }> = {
    submit: {
        title: 'Submit for approval',
        body: 'The reviewer is notified by email. You can keep working; any change to the company or its events returns the book to draft.',
        confirm: 'Submit',
        noteLabel: 'Note for the reviewer (optional)',
        noteRequired: false,
    },
    approve: {
        title: 'Approve minute book',
        body: 'Approving removes the DRAFT watermark from the compiled book. A later change to the company or its events returns it to draft.',
        confirm: 'Approve',
        noteLabel: 'Note (optional)',
        noteRequired: false,
    },
    'request-changes': {
        title: 'Request changes',
        body: 'The book goes back to the preparer with your note.',
        confirm: 'Send back',
        noteLabel: 'What needs to change',
        noteRequired: true,
    },
    reopen: {
        title: 'Reopen as draft',
        body: 'The book returns to draft and the compiled PDF carries the DRAFT watermark again until it is approved.',
        confirm: 'Reopen',
        noteLabel: 'Reason (optional)',
        noteRequired: false,
    },
};

const formatDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '';

export const ApprovalChip: React.FC<{ approval?: Approval | null }> = ({ approval }) => {
    const status = approval?.status;
    if (!status) return null;
    const s = STATUS_CHIP[status];
    return <Chip size="small" label={s.label} sx={{ height: 18, fontSize: 10, fontWeight: 600, bgcolor: s.bg, color: s.color }} />;
};

/**
 * Minute book approval — who does what is decided by the backend; this only
 * shows the buttons that make sense for the viewer:
 *
 *   firm company      preparers submit, a firm supervisor approves (and may
 *                     approve their own draft directly)
 *   personal company  the owner submits, a CRS reviewer approves
 */
const ApprovalPanel: React.FC<{ company: any; onChange: (approval: Approval) => void }> = ({ company, onChange }) => {
    const { showSnackbar } = useSnackbar();
    const firm = useSelector((state: any) => state.auth?.user?.organization) as { _id: string; role: string } | null;

    const [dialog, setDialog] = useState<Action | null>(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);

    const approval: Approval = company?.approval ?? {};
    const status: Status | undefined = approval.status;
    const isFirmBook = !!company?.organizationId;
    const isSupervisor = isFirmBook && firm?._id === String(company.organizationId) && firm?.role === 'supervisor';
    const reviewerLabel = isFirmBook ? 'a firm supervisor' : 'a CRS reviewer';

    const open = (action: Action) => { setNote(''); setDialog(action); };

    const confirm = async () => {
        if (!dialog) return;
        setBusy(true);
        try {
            const { data } = await api.post(`/companies/${company._id}/approval/${dialog}`, note.trim() ? { note: note.trim() } : {});
            onChange(data.approval ?? {});
            showSnackbar({
                submit: 'Submitted for approval.',
                approve: 'Minute book approved.',
                'request-changes': 'Sent back for changes.',
                reopen: 'Reopened as a draft.',
            }[dialog], 'success');
            setDialog(null);
        } catch (err: any) {
            showSnackbar(err?.response?.data?.error || 'That did not work. Please try again.', 'error');
        } finally {
            setBusy(false);
        }
    };

    let message: React.ReactNode;
    const actions: React.ReactNode[] = [];

    if (!status) {
        message = `This minute book has not been through approval. Submit it and ${reviewerLabel} will review it.`;
        actions.push(<Button key="submit" size="small" variant="contained" onClick={() => open('submit')}>Submit for approval</Button>);
        if (isSupervisor) actions.push(<Button key="approve" size="small" variant="outlined" onClick={() => open('approve')}>Approve now</Button>);
    } else if (status === 'draft') {
        message = `Draft. The compiled minute book carries a DRAFT watermark until ${reviewerLabel} approves it.`;
        actions.push(<Button key="submit" size="small" variant="contained" onClick={() => open('submit')}>Submit for approval</Button>);
        if (isSupervisor) actions.push(<Button key="approve" size="small" variant="outlined" onClick={() => open('approve')}>Approve now</Button>);
    } else if (status === 'submitted') {
        message = `Waiting for ${reviewerLabel}${approval.submittedAt ? ` since ${formatDate(approval.submittedAt)}` : ''}.`;
        if (isSupervisor) {
            actions.push(<Button key="approve" size="small" variant="contained" color="success" onClick={() => open('approve')}>Approve</Button>);
            actions.push(<Button key="changes" size="small" variant="outlined" color="warning" onClick={() => open('request-changes')}>Request changes</Button>);
        } else {
            actions.push(<Button key="withdraw" size="small" onClick={() => open('reopen')}>Withdraw</Button>);
        }
    } else if (status === 'changes_requested') {
        message = 'The reviewer sent this minute book back. Make the changes, then resubmit.';
        actions.push(<Button key="resubmit" size="small" variant="contained" onClick={() => open('submit')}>Resubmit</Button>);
        if (isSupervisor) actions.push(<Button key="approve" size="small" variant="outlined" onClick={() => open('approve')}>Approve now</Button>);
    } else {
        message = `Approved${approval.reviewedAt ? ` on ${formatDate(approval.reviewedAt)}` : ''}. The compiled minute book is final.`;
        actions.push(<Button key="reopen" size="small" onClick={() => open('reopen')}>Reopen for changes</Button>);
    }

    const cfg = dialog ? DIALOG[dialog] : null;

    return (
        <Box
            mb={3}
            px={2}
            py={1.5}
            sx={{
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: status === 'approved' ? '#c5e1a5' : 'divider',
                bgcolor: status === 'approved' ? '#f7fbf2' : '#fafbfc',
            }}
        >
            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                {status === 'approved' && <VerifiedIcon sx={{ color: '#2e7d32', fontSize: 18 }} />}
                <Typography variant="body2" fontWeight={700}>Minute book approval</Typography>
                <ApprovalChip approval={approval} />
                <Box flex={1} />
                <Box display="flex" gap={1}>{actions}</Box>
            </Box>
            <Typography variant="body2" color="text.secondary" mt={0.75}>{message}</Typography>
            {status === 'changes_requested' && approval.note && (
                <Alert severity="warning" sx={{ mt: 1 }}>{approval.note}</Alert>
            )}
            {status === 'submitted' && approval.note && (
                <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                    Note: {approval.note}
                </Typography>
            )}

            <Dialog open={!!dialog} onClose={() => !busy && setDialog(null)} maxWidth="sm" fullWidth>
                {cfg && (
                    <>
                        <DialogTitle>{cfg.title}</DialogTitle>
                        <DialogContent>
                            <DialogContentText mb={2}>{cfg.body}</DialogContentText>
                            <TextField
                                fullWidth
                                multiline
                                minRows={2}
                                label={cfg.noteLabel}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                inputProps={{ maxLength: 2000 }}
                            />
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setDialog(null)} disabled={busy}>Cancel</Button>
                            <Button
                                variant="contained"
                                onClick={confirm}
                                disabled={busy || (cfg.noteRequired && !note.trim())}
                            >
                                {cfg.confirm}
                            </Button>
                        </DialogActions>
                    </>
                )}
            </Dialog>
        </Box>
    );
};

export default ApprovalPanel;
