import React, { useCallback, useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Button, TextField, MenuItem, Select, Chip, Alert, CircularProgress,
    Table, TableBody, TableCell, TableHead, TableRow, IconButton, Tooltip,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useDispatch, useSelector } from 'react-redux';
import api from '../utils/api';
import { setOrganization, type AuthOrganization } from '../store/authSlice';
import { useSnackbar } from '../context/SnackbarContext';

type FirmRole = 'supervisor' | 'member';

interface Member { _id: string; name: string; email: string; role: FirmRole; joinedAt?: string }
interface Invite { _id: string; email: string; role: FirmRole; invitedAt: string }
interface PendingInvite { organizationId: string; organizationName: string; role: FirmRole; invitedAt: string; invitedBy: string }

interface FirmData {
    organization: { _id: string; name: string } | null;
    role: FirmRole | null;
    members: Member[];
    invites: Invite[];
    pendingInvites: PendingInvite[];
}

const ROLE_LABEL: Record<FirmRole, string> = {
    supervisor: 'Supervisor',
    member: 'Team member',
};

const ROLE_HELP: Record<FirmRole, string> = {
    supervisor: 'Manages members and approves minute books',
    member: 'Builds and maintains client minute books (e.g. a legal assistant)',
};

const card = { p: 2.5, mb: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'white' } as const;

const errorText = (err: any, fallback: string) => err?.response?.data?.error || fallback;

const formatDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

/**
 * Firm workspace — a law office (or any team) shares its client minute books.
 *
 *   - No firm yet: create one (you become its supervisor) or accept an
 *     invitation sent to your email.
 *   - In a firm: everyone sees the member list; supervisors rename the firm,
 *     invite people, change roles and remove members; anyone can leave.
 *
 * The backend enforces every rule here; the UI only hides what a role can't do.
 */
const FirmPage: React.FC = () => {
    const dispatch = useDispatch();
    const { showSnackbar } = useSnackbar();
    const me = useSelector((state: any) => state.auth?.user);

    const [data, setData] = useState<FirmData | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [busy, setBusy] = useState(false);

    const [newFirmName, setNewFirmName] = useState('');
    const [renameValue, setRenameValue] = useState('');
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<FirmRole>('member');
    const [confirm, setConfirm] = useState<{ kind: 'remove' | 'leave'; member?: Member } | null>(null);

    const load = useCallback(async () => {
        try {
            const { data: fresh } = await api.get<FirmData>('/organization');
            setData(fresh);
            setRenameValue(fresh.organization?.name ?? '');
            setLoadError(false);
            // Keep the signed-in shell in step with membership changes made
            // elsewhere (e.g. a supervisor removed this user).
            const org: AuthOrganization | null = fresh.organization && fresh.role
                ? { _id: fresh.organization._id, name: fresh.organization.name, role: fresh.role }
                : null;
            dispatch(setOrganization(org));
        } catch {
            setLoadError(true);
        }
    }, [dispatch]);

    useEffect(() => { load(); }, [load]);

    const run = async (action: () => Promise<unknown>, success: string, fallback: string) => {
        setBusy(true);
        try {
            await action();
            showSnackbar(success, 'success');
            await load();
            return true;
        } catch (err: any) {
            showSnackbar(errorText(err, fallback), 'error');
            return false;
        } finally {
            setBusy(false);
        }
    };

    const createFirm = () => run(
        () => api.post('/organization', { name: newFirmName.trim() }),
        'Firm created. You are its supervisor.',
        'Could not create the firm.',
    );

    const renameFirm = () => run(
        () => api.patch('/organization', { name: renameValue.trim() }),
        'Firm renamed.',
        'Could not rename the firm.',
    );

    const sendInvite = async () => {
        setBusy(true);
        try {
            const { data: result } = await api.post('/organization/invites', { email: inviteEmail.trim(), role: inviteRole });
            showSnackbar(
                result.emailSent
                    ? `Invitation sent to ${result.invite.email}.`
                    : `Invitation saved for ${result.invite.email}, but the email could not be sent. They will still see it when they sign in.`,
                result.emailSent ? 'success' : 'warning',
            );
            setInviteEmail('');
            setInviteRole('member');
            await load();
        } catch (err: any) {
            showSnackbar(errorText(err, 'Could not send the invitation.'), 'error');
        } finally {
            setBusy(false);
        }
    };

    const revokeInvite = (invite: Invite) => run(
        () => api.delete(`/organization/invites/${invite._id}`),
        `Invitation to ${invite.email} revoked.`,
        'Could not revoke the invitation.',
    );

    const acceptInvite = (inv: PendingInvite) => run(
        () => api.post(`/organization/invites/${inv.organizationId}/accept`),
        `You joined ${inv.organizationName}.`,
        'Could not accept the invitation.',
    );

    const declineInvite = (inv: PendingInvite) => run(
        () => api.post(`/organization/invites/${inv.organizationId}/decline`),
        'Invitation declined.',
        'Could not decline the invitation.',
    );

    const changeRole = (member: Member, role: FirmRole) => run(
        () => api.patch(`/organization/members/${member._id}`, { role }),
        `${member.name || member.email} is now ${ROLE_LABEL[role].toLowerCase()}.`,
        'Could not change the role.',
    );

    const confirmRemoval = async () => {
        if (!confirm) return;
        const leaving = confirm.kind === 'leave';
        const targetId = leaving ? me?._id : confirm.member?._id;
        setConfirm(null);
        await run(
            () => api.delete(`/organization/members/${targetId}`),
            leaving ? 'You left the firm.' : 'Member removed.',
            leaving ? 'Could not leave the firm.' : 'Could not remove the member.',
        );
    };

    if (!data && !loadError) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
                <CircularProgress />
            </Box>
        );
    }

    const org = data?.organization ?? null;
    const isSupervisor = data?.role === 'supervisor';

    return (
        <Box sx={{ p: 3, bgcolor: '#f5f6fa', minHeight: '100vh' }}>
            <Box mb={2.5}>
                <Typography variant="h5" fontWeight={700} lineHeight={1.2}>Firm</Typography>
                <Typography variant="body2" color="text.secondary" mt={0.3}>
                    Share client minute books with your team
                </Typography>
            </Box>

            {loadError && (
                <Alert severity="error" sx={{ mb: 2.5 }} action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>
                    Your firm details could not be loaded.
                </Alert>
            )}

            <Box sx={{ maxWidth: 820 }}>
                {/* Invitations addressed to this user */}
                {(data?.pendingInvites ?? []).map((inv) => (
                    <Paper key={inv.organizationId} elevation={0} sx={{ ...card, borderColor: 'primary.light', bgcolor: '#f3f5ff' }}>
                        <Typography variant="subtitle1" fontWeight={700}>
                            Invitation to join {inv.organizationName}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" mt={0.5}>
                            {inv.invitedBy ? `${inv.invitedBy} invited you` : 'You were invited'} as {ROLE_LABEL[inv.role].toLowerCase()} on {formatDate(inv.invitedAt)}.
                        </Typography>
                        {org && (
                            <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                                You are already in {org.name}. Leave it first to accept this invitation.
                            </Typography>
                        )}
                        <Box display="flex" gap={1} mt={1.5}>
                            <Button variant="contained" size="small" disabled={busy || !!org} onClick={() => acceptInvite(inv)}>Accept</Button>
                            <Button size="small" disabled={busy} onClick={() => declineInvite(inv)}>Decline</Button>
                        </Box>
                    </Paper>
                ))}

                {data && !org && (
                    <Paper elevation={0} sx={card}>
                        <Typography variant="subtitle1" fontWeight={700} mb={0.5}>Set up your firm</Typography>
                        <Typography variant="body2" color="text.secondary" mb={2} sx={{ lineHeight: 1.6 }}>
                            A firm workspace lets your team work on the same client minute books. You become its
                            supervisor: you invite members, and supervisors approve minute books. Companies you already
                            have stay personal — you can move them into the firm from the dashboard.
                        </Typography>
                        <Box display="flex" gap={1.5} flexWrap="wrap">
                            <TextField
                                size="small"
                                label="Firm name"
                                placeholder="e.g. Smith & Associates LLP"
                                value={newFirmName}
                                onChange={(e) => setNewFirmName(e.target.value)}
                                inputProps={{ maxLength: 120 }}
                                sx={{ flex: '1 1 280px' }}
                            />
                            <Button variant="contained" disabled={busy || !newFirmName.trim()} onClick={createFirm}>
                                Create firm
                            </Button>
                        </Box>
                    </Paper>
                )}

                {org && data && (
                    <>
                        <Paper elevation={0} sx={card}>
                            <Box display="flex" alignItems="center" gap={1} mb={isSupervisor ? 2 : 0}>
                                <Typography variant="subtitle1" fontWeight={700}>{org.name}</Typography>
                                <Chip size="small" label={`You: ${ROLE_LABEL[data.role!]}`} sx={{ height: 22, fontSize: 12 }} />
                            </Box>
                            {isSupervisor && (
                                <Box display="flex" gap={1.5} flexWrap="wrap">
                                    <TextField
                                        size="small"
                                        label="Firm name"
                                        value={renameValue}
                                        onChange={(e) => setRenameValue(e.target.value)}
                                        inputProps={{ maxLength: 120 }}
                                        sx={{ flex: '1 1 280px' }}
                                    />
                                    <Button
                                        variant="outlined"
                                        disabled={busy || !renameValue.trim() || renameValue.trim() === org.name}
                                        onClick={renameFirm}
                                    >
                                        Rename
                                    </Button>
                                </Box>
                            )}
                        </Paper>

                        <Paper elevation={0} sx={card}>
                            <Typography variant="subtitle1" fontWeight={700} mb={1}>
                                Members ({data.members.length})
                            </Typography>
                            <Box sx={{ overflowX: 'auto' }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Name</TableCell>
                                            <TableCell>Role</TableCell>
                                            <TableCell>Joined</TableCell>
                                            {isSupervisor && <TableCell align="right" />}
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {data.members.map((m) => {
                                            const isMe = m._id === me?._id;
                                            return (
                                                <TableRow key={m._id}>
                                                    <TableCell>
                                                        <Typography variant="body2" fontWeight={600}>
                                                            {m.name || m.email}{isMe ? ' (you)' : ''}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">{m.email}</Typography>
                                                    </TableCell>
                                                    <TableCell>
                                                        {isSupervisor ? (
                                                            <Select
                                                                size="small"
                                                                value={m.role}
                                                                disabled={busy}
                                                                onChange={(e) => changeRole(m, e.target.value as FirmRole)}
                                                                sx={{ fontSize: 14, minWidth: 150 }}
                                                            >
                                                                <MenuItem value="supervisor">{ROLE_LABEL.supervisor}</MenuItem>
                                                                <MenuItem value="member">{ROLE_LABEL.member}</MenuItem>
                                                            </Select>
                                                        ) : (
                                                            <Typography variant="body2">{ROLE_LABEL[m.role]}</Typography>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Typography variant="body2" color="text.secondary">{formatDate(m.joinedAt)}</Typography>
                                                    </TableCell>
                                                    {isSupervisor && (
                                                        <TableCell align="right">
                                                            {!isMe && (
                                                                <Tooltip title="Remove from firm">
                                                                    <IconButton
                                                                        size="small"
                                                                        disabled={busy}
                                                                        onClick={() => setConfirm({ kind: 'remove', member: m })}
                                                                    >
                                                                        <DeleteOutlineIcon fontSize="small" />
                                                                    </IconButton>
                                                                </Tooltip>
                                                            )}
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </Box>
                        </Paper>

                        {isSupervisor && (
                            <Paper elevation={0} sx={card}>
                                <Typography variant="subtitle1" fontWeight={700} mb={0.5}>Invite a member</Typography>
                                <Typography variant="body2" color="text.secondary" mb={2}>
                                    They sign in with this email address and accept the invitation from their Firm page.
                                </Typography>
                                <Box display="flex" gap={1.5} flexWrap="wrap" alignItems="flex-start">
                                    <TextField
                                        size="small"
                                        type="email"
                                        label="Email"
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        sx={{ flex: '1 1 240px' }}
                                    />
                                    <Select
                                        size="small"
                                        value={inviteRole}
                                        onChange={(e) => setInviteRole(e.target.value as FirmRole)}
                                        sx={{ minWidth: 170 }}
                                    >
                                        <MenuItem value="member">{ROLE_LABEL.member}</MenuItem>
                                        <MenuItem value="supervisor">{ROLE_LABEL.supervisor}</MenuItem>
                                    </Select>
                                    <Button
                                        variant="contained"
                                        disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())}
                                        onClick={sendInvite}
                                    >
                                        Send invitation
                                    </Button>
                                </Box>
                                <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                                    {ROLE_LABEL[inviteRole]}: {ROLE_HELP[inviteRole].toLowerCase()}.
                                </Typography>

                                {data.invites.length > 0 && (
                                    <Box mt={2.5}>
                                        <Typography variant="body2" fontWeight={700} mb={1}>Pending invitations</Typography>
                                        {data.invites.map((inv) => (
                                            <Box
                                                key={inv._id}
                                                display="flex"
                                                alignItems="center"
                                                justifyContent="space-between"
                                                gap={1}
                                                py={0.75}
                                                sx={{ borderTop: '1px solid', borderColor: 'divider' }}
                                            >
                                                <Box>
                                                    <Typography variant="body2">{inv.email}</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {ROLE_LABEL[inv.role]} · invited {formatDate(inv.invitedAt)}
                                                    </Typography>
                                                </Box>
                                                <Button size="small" color="error" disabled={busy} onClick={() => revokeInvite(inv)}>
                                                    Revoke
                                                </Button>
                                            </Box>
                                        ))}
                                    </Box>
                                )}
                            </Paper>
                        )}

                        <Paper elevation={0} sx={{ ...card, borderColor: '#ef9a9a' }}>
                            <Typography variant="subtitle1" fontWeight={700} color="#c62828" mb={0.5}>Leave firm</Typography>
                            <Typography variant="body2" color="text.secondary" mb={1.5} sx={{ lineHeight: 1.6 }}>
                                You lose access to {org.name}&apos;s companies. They stay with the firm. Your personal
                                companies are not affected.
                            </Typography>
                            <Button variant="outlined" color="error" disabled={busy} onClick={() => setConfirm({ kind: 'leave' })}>
                                Leave {org.name}
                            </Button>
                        </Paper>
                    </>
                )}
            </Box>

            <Dialog open={!!confirm} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
                <DialogTitle>{confirm?.kind === 'leave' ? 'Leave the firm?' : 'Remove member?'}</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {confirm?.kind === 'leave'
                            ? `You will lose access to ${org?.name ?? 'the firm'}'s companies. A supervisor can invite you back.`
                            : `${confirm?.member?.name || confirm?.member?.email} will lose access to the firm's companies immediately. Their work stays with the firm.`}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirm(null)}>Cancel</Button>
                    <Button color="error" variant="contained" onClick={confirmRemoval}>
                        {confirm?.kind === 'leave' ? 'Leave' : 'Remove'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default FirmPage;
