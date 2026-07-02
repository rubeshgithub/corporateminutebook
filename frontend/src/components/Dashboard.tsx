import React from 'react';
import {
    Box, Typography, Button, Paper, Grid, IconButton, TextField, InputAdornment,
    Avatar, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    TablePagination, TableSortLabel, Tooltip, Chip, Divider,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Stack
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import AddIcon from '@mui/icons-material/Add';
import BusinessIcon from '@mui/icons-material/Business';
import DescriptionIcon from '@mui/icons-material/Description';
import GroupIcon from '@mui/icons-material/Group';
import PieChartIcon from '@mui/icons-material/PieChart';
import TimelineIcon from '@mui/icons-material/Timeline';
import ShareIcon from '@mui/icons-material/Share';
import ArchiveIcon from '@mui/icons-material/Archive';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import api from '../utils/api';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from '../context/SnackbarContext';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Stats {
    companies: number;
    documents: number;
    directors: number;
    shareholders: number;
    sharesIssued: number;
    activityLast7Days: number;
}

interface ComplianceEntry {
    companyId: string;
    issues: number;
    missingResolutions: number;
    missingRegistryFilings: number;
    annualReturnStatus: 'not_set' | 'ok' | 'due_soon' | 'overdue';
    daysUntilAnnualReturn: number | null;
    missingIncorpDoc: boolean;
    expectedAnnualReturns: number;
    filedAnnualReturns: number;
    missingAnnualReturnYears: number[];
}

type Order = 'asc' | 'desc';
type OrderBy = 'name' | 'incorporationDate' | 'directors' | 'shareholders' | 'compliance';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#1a237e', '#00695c', '#4527a0', '#c62828', '#ef6c00', '#1565c0', '#2e7d32', '#6a1b9a'];

const getAvatarColor = (name: string) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};

const getInitials = (name: string) => {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};

const formatRelative = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
};

const formatAction = (action: string) =>
    action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const ACTION_COLORS: Record<string, string> = {
    GENERATED_DOCUMENT: '#1565c0',
    COMPILED_MINUTE_BOOK: '#1a237e',
    CREATED_COMPANY: '#2e7d32',
    UPDATED_COMPANY: '#ef6c00',
    DELETED_COMPANY: '#c62828',
    RECORDED_EVENT: '#4527a0',
};

// ─── Compliance badge ─────────────────────────────────────────────────────────

const ComplianceBadge: React.FC<{ c: ComplianceEntry | undefined; onClick: () => void }> = ({ c, onClick }) => {
    if (!c) return <Chip label="—" size="small" sx={{ height: 20, fontSize: 11 }} />;

    const isOverdue = c.annualReturnStatus === 'overdue';
    const isDueSoon = c.annualReturnStatus === 'due_soon';
    const totalIssues = c.issues + (isOverdue ? 1 : 0);

    // Build tooltip lines
    const lines: string[] = [];
    if (isOverdue) lines.push('Annual return OVERDUE');
    else if (isDueSoon) lines.push(`Annual return due in ${c.daysUntilAnnualReturn}d`);
    if (c.missingIncorpDoc) lines.push('No incorporation document uploaded');
    if (c.missingAnnualReturnYears?.length > 0)
        lines.push(`Annual return${c.missingAnnualReturnYears.length > 1 ? 's' : ''} not filed: FY ${c.missingAnnualReturnYears.join(', ')}`);
    if (c.missingResolutions > 0) lines.push(`${c.missingResolutions} event${c.missingResolutions > 1 ? 's' : ''} missing a signed resolution`);
    if (c.missingRegistryFilings > 0) lines.push(`${c.missingRegistryFilings} event${c.missingRegistryFilings > 1 ? 's' : ''} missing a registry filing`);
    if (lines.length === 0) lines.push('All records complete');

    const clean = totalIssues === 0 && !isDueSoon;

    return (
        <Tooltip
            title={
                <Box>
                    {lines.map((l, i) => <Typography key={i} variant="caption" display="block" fontSize={11}>{l}</Typography>)}
                    <Typography variant="caption" display="block" fontSize={10} mt={0.5} sx={{ opacity: 0.7 }}>
                        Based on recorded events
                    </Typography>
                </Box>
            }
            arrow
        >
            <Chip
                icon={
                    clean
                        ? <CheckCircleIcon sx={{ fontSize: '13px !important', color: '#2e7d32 !important' }} />
                        : isOverdue
                        ? <WarningAmberIcon sx={{ fontSize: '13px !important', color: '#c62828 !important' }} />
                        : <WarningAmberIcon sx={{ fontSize: '13px !important', color: '#e65100 !important' }} />
                }
                label={
                    clean ? 'Clean'
                    : isOverdue ? 'Overdue'
                    : isDueSoon && totalIssues === 0 ? `${c.daysUntilAnnualReturn}d`
                    : `${totalIssues} pending`
                }
                size="small"
                onClick={(e) => { e.stopPropagation(); onClick(); }}
                sx={{
                    height: 22,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    bgcolor: clean ? '#f1f8e9' : isOverdue ? '#ffebee' : isDueSoon && totalIssues === 0 ? '#fff3e0' : '#fff8e1',
                    color: clean ? '#33691e' : isOverdue ? '#c62828' : isDueSoon && totalIssues === 0 ? '#e65100' : '#f57f17',
                    border: '1px solid',
                    borderColor: clean ? '#aed581' : isOverdue ? '#ef9a9a' : isDueSoon && totalIssues === 0 ? '#ffcc80' : '#ffe082',
                    '& .MuiChip-icon': { ml: '6px' },
                }}
            />
        </Tooltip>
    );
};

// ─── Dashboard ────────────────────────────────────────────────────────────────

const Dashboard: React.FC = () => {
    const navigate = useNavigate();
    const { showSnackbar } = useSnackbar();
    const [companies, setCompanies] = React.useState<any[]>([]);
    const [compliance, setCompliance] = React.useState<ComplianceEntry[]>([]);
    const [activity, setActivity] = React.useState<any[]>([]);
    const [stats, setStats] = React.useState<Stats | null>(null);
    const [search, setSearch] = React.useState('');
    const [page, setPage] = React.useState(0);
    const [rowsPerPage, setRowsPerPage] = React.useState(10);
    const [order, setOrder] = React.useState<Order>('asc');
    const [orderBy, setOrderBy] = React.useState<OrderBy>('name');
    const [deleteDialog, setDeleteDialog] = React.useState<{ open: boolean; companyId: string; companyName: string }>({ open: false, companyId: '', companyName: '' });

    const fetchAll = async () => {
        try {
            const [companiesRes, complianceRes, activityRes, statsRes] = await Promise.all([
                api.get('/companies'),
                api.get('/companies/compliance'),
                api.get('/activity', { params: { limit: 15 } }),
                api.get('/stats'),
            ]);
            setCompanies(companiesRes.data);
            setCompliance(complianceRes.data);
            setActivity(activityRes.data);
            setStats(statsRes.data);
        } catch (error) {
            console.error('Dashboard load error:', error);
        }
    };

    React.useEffect(() => { fetchAll(); }, []);

    const complianceMap = React.useMemo(() => {
        const m: Record<string, ComplianceEntry> = {};
        for (const c of compliance) m[c.companyId] = c;
        return m;
    }, [compliance]);

    const handleDelete = (companyId: string, companyName: string) => {
        setDeleteDialog({ open: true, companyId, companyName });
    };

    const confirmDelete = async () => {
        const { companyId } = deleteDialog;
        setDeleteDialog({ open: false, companyId: '', companyName: '' });
        try {
            await api.delete(`/companies/${companyId}`);
            setCompanies((prev) => prev.filter((c) => c._id !== companyId));
            fetchAll();
            showSnackbar('Company deleted.', 'success');
        } catch {
            showSnackbar('Failed to delete company.', 'error');
        }
    };

    const handleSort = (col: OrderBy) => {
        if (orderBy === col) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
        else { setOrderBy(col); setOrder('asc'); }
        setPage(0);
    };

    const filteredCompanies = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return companies;
        return companies.filter(
            (c) =>
                (c.name || '').toLowerCase().includes(q) ||
                (c.corporateAccessNumber || '').toLowerCase().includes(q) ||
                (c.businessNumber || '').toLowerCase().includes(q),
        );
    }, [companies, search]);

    const sortedCompanies = React.useMemo(() => {
        return [...filteredCompanies].sort((a, b) => {
            let av: any, bv: any;
            if (orderBy === 'name') { av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); }
            else if (orderBy === 'incorporationDate') { av = a.incorporationDate ? new Date(a.incorporationDate).getTime() : 0; bv = b.incorporationDate ? new Date(b.incorporationDate).getTime() : 0; }
            else if (orderBy === 'directors') { av = a.directors?.length ?? 0; bv = b.directors?.length ?? 0; }
            else if (orderBy === 'shareholders') { av = a.shareholders?.length ?? 0; bv = b.shareholders?.length ?? 0; }
            else if (orderBy === 'compliance') {
                const ca = complianceMap[a._id];
                const cb = complianceMap[b._id];
                const score = (c: ComplianceEntry | undefined) => {
                    if (!c) return 0;
                    return (c.annualReturnStatus === 'overdue' ? 100 : c.annualReturnStatus === 'due_soon' ? 50 : 0) + c.issues;
                };
                av = score(ca); bv = score(cb);
            }
            return order === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
        });
    }, [filteredCompanies, order, orderBy, complianceMap]);

    const paginatedCompanies = sortedCompanies.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

    const statItems = [
        { label: 'Companies', value: stats?.companies ?? '—', icon: <BusinessIcon sx={{ fontSize: 18 }} />, color: '#1a237e' },
        { label: 'Documents', value: stats?.documents ?? '—', icon: <DescriptionIcon sx={{ fontSize: 18 }} />, color: '#1565c0' },
        { label: 'Directors', value: stats?.directors ?? '—', icon: <GroupIcon sx={{ fontSize: 18 }} />, color: '#4527a0' },
        { label: 'Shareholders', value: stats?.shareholders ?? '—', icon: <PieChartIcon sx={{ fontSize: 18 }} />, color: '#c62828' },
        { label: 'Shares Issued', value: stats?.sharesIssued ?? '—', icon: <ShareIcon sx={{ fontSize: 18 }} />, color: '#ef6c00' },
        { label: 'Activity (7d)', value: stats?.activityLast7Days ?? '—', icon: <TimelineIcon sx={{ fontSize: 18 }} />, color: '#2e7d32' },
    ];

    // Companies with urgent compliance issues for the banner
    const urgentCompanies = React.useMemo(() => {
        return companies
            .map((c) => ({ ...c, _c: complianceMap[c._id] }))
            .filter((c) => c._c?.annualReturnStatus === 'overdue' || c._c?.annualReturnStatus === 'due_soon')
            .sort((a, b) => (a._c?.daysUntilAnnualReturn ?? 999) - (b._c?.daysUntilAnnualReturn ?? 999));
    }, [companies, complianceMap]);

    return (
        <Box sx={{ p: 3, bgcolor: '#f5f6fa', minHeight: '100vh' }}>

            {/* Page header */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2.5}>
                <Box>
                    <Typography variant="h5" fontWeight={700} lineHeight={1.2}>Corporate Dashboard</Typography>
                    <Typography variant="body2" color="text.secondary" mt={0.3}>
                        Manage companies, documents and corporate records
                    </Typography>
                </Box>
                <Box display="flex" gap={1}>
                    <Button variant="outlined" size="small" onClick={() => navigate('/documents')}>
                        Document Vault
                    </Button>
                    <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => navigate('/builder')}>
                        New Company
                    </Button>
                </Box>
            </Box>

            {/* Annual return compliance banner */}
            {urgentCompanies.length > 0 && (
                <Box
                    sx={{
                        mb: 2.5, p: 1.25, px: 2, borderRadius: 2,
                        bgcolor: '#fff8e1', border: '1px solid #ffe082',
                        display: 'flex', alignItems: 'center', gap: 1.5,
                    }}
                >
                    <WarningAmberIcon sx={{ color: '#f57f17', fontSize: 20, flexShrink: 0 }} />
                    <Typography variant="body2" fontWeight={600} color="#e65100" sx={{ flexShrink: 0 }}>
                        Annual returns:
                    </Typography>
                    <Box display="flex" flexWrap="wrap" gap={0.75}>
                        {urgentCompanies.map((c) => (
                            <Chip
                                key={c._id}
                                label={
                                    c._c.annualReturnStatus === 'overdue'
                                        ? `${c.name} — Overdue`
                                        : `${c.name} — ${c._c.daysUntilAnnualReturn}d`
                                }
                                size="small"
                                onClick={() => navigate(`/records/${c._id}`)}
                                sx={{
                                    bgcolor: c._c.annualReturnStatus === 'overdue' ? '#ffccbc' : '#fff3e0',
                                    border: '1px solid',
                                    borderColor: c._c.annualReturnStatus === 'overdue' ? '#ff7043' : '#ffb300',
                                    cursor: 'pointer', fontWeight: 600, fontSize: 11,
                                }}
                            />
                        ))}
                    </Box>
                </Box>
            )}

            {/* Stats strip */}
            <Grid container spacing={1.5} mb={2.5}>
                {statItems.map((s) => (
                    <Grid item xs={6} sm={4} md={2} key={s.label}>
                        <Paper elevation={0} sx={{
                            p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider',
                            borderLeft: `4px solid ${s.color}`, bgcolor: 'white',
                        }}>
                            <Box display="flex" alignItems="center" gap={0.8} mb={0.2}>
                                <Box sx={{ color: s.color }}>{s.icon}</Box>
                                <Typography variant="caption" color="text.secondary" fontWeight={500}>{s.label}</Typography>
                            </Box>
                            <Typography variant="h6" fontWeight={700} lineHeight={1}>
                                {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
                            </Typography>
                        </Paper>
                    </Grid>
                ))}
            </Grid>

            {/* ─── Companies table (full width) ───────────────────────────────── */}
            <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'white', overflow: 'hidden', mb: 2.5 }}>

                {/* Toolbar */}
                <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
                        Companies
                        {filteredCompanies.length > 0 && (
                            <Chip label={filteredCompanies.length} size="small" sx={{ ml: 1, height: 18, fontSize: 11 }} />
                        )}
                    </Typography>
                    <TextField
                        size="small"
                        placeholder="Search by name, CAN or BN…"
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                        sx={{ width: 260, '& .MuiOutlinedInput-root': { fontSize: 13 } }}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                                </InputAdornment>
                            ),
                        }}
                    />
                </Box>

                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow sx={{ bgcolor: '#fafafa' }}>
                                <TableCell sx={{ width: 44, py: 1 }} />
                                <TableCell sx={{ py: 1, fontWeight: 600, fontSize: 12, minWidth: 200 }}>
                                    <TableSortLabel active={orderBy === 'name'} direction={orderBy === 'name' ? order : 'asc'} onClick={() => handleSort('name')}>
                                        Company
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell sx={{ py: 1, fontWeight: 600, fontSize: 12 }}>
                                    <TableSortLabel active={orderBy === 'incorporationDate'} direction={orderBy === 'incorporationDate' ? order : 'asc'} onClick={() => handleSort('incorporationDate')}>
                                        Incorporated
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell align="center" sx={{ py: 1, fontWeight: 600, fontSize: 12 }}>
                                    <TableSortLabel active={orderBy === 'directors'} direction={orderBy === 'directors' ? order : 'asc'} onClick={() => handleSort('directors')}>
                                        Dir.
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell align="center" sx={{ py: 1, fontWeight: 600, fontSize: 12 }}>
                                    <TableSortLabel active={orderBy === 'shareholders'} direction={orderBy === 'shareholders' ? order : 'asc'} onClick={() => handleSort('shareholders')}>
                                        S/H
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell sx={{ py: 1, fontWeight: 600, fontSize: 12, minWidth: 130 }}>
                                    <Tooltip title="Tracks missing signed resolutions, registry filings, and annual return status based on recorded corporate events" arrow>
                                        <TableSortLabel active={orderBy === 'compliance'} direction={orderBy === 'compliance' ? order : 'asc'} onClick={() => handleSort('compliance')}>
                                            Compliance
                                        </TableSortLabel>
                                    </Tooltip>
                                </TableCell>
                                <TableCell align="right" sx={{ py: 1, fontWeight: 600, fontSize: 12 }}>Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {paginatedCompanies.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary', fontSize: 13 }}>
                                        {search ? `No companies match "${search}"` : 'No companies yet — create your first one.'}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                paginatedCompanies.map((company) => {
                                    const comp = complianceMap[company._id];
                                    const isOverdue = comp?.annualReturnStatus === 'overdue';
                                    return (
                                        <TableRow
                                            key={company._id}
                                            hover
                                            sx={{
                                                cursor: 'default',
                                                '&:last-child td': { borderBottom: 0 },
                                                bgcolor: isOverdue ? '#fff8f8' : undefined,
                                            }}
                                        >
                                            <TableCell sx={{ py: 0.75, pl: 1.5 }}>
                                                <Avatar sx={{ width: 30, height: 30, fontSize: 11, fontWeight: 700, bgcolor: getAvatarColor(company.name) }}>
                                                    {getInitials(company.name)}
                                                </Avatar>
                                            </TableCell>

                                            <TableCell sx={{ py: 0.75 }}>
                                                <Typography variant="body2" fontWeight={600} lineHeight={1.3}>{company.name}</Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {company.corporateAccessNumber
                                                        ? `CAN: ${company.corporateAccessNumber}`
                                                        : company.businessNumber
                                                        ? `BN: ${company.businessNumber}`
                                                        : '—'}
                                                </Typography>
                                            </TableCell>

                                            <TableCell sx={{ py: 0.75 }}>
                                                <Typography variant="body2" color="text.secondary" fontSize={12}>
                                                    {company.incorporationDate
                                                        ? new Date(company.incorporationDate).toLocaleDateString()
                                                        : '—'}
                                                </Typography>
                                                {company.fiscalYearEnd && (
                                                    <Typography variant="caption" color="text.disabled" fontSize={11} display="block">
                                                        FY: {company.fiscalYearEnd}
                                                    </Typography>
                                                )}
                                            </TableCell>

                                            <TableCell align="center" sx={{ py: 0.75 }}>
                                                <Tooltip
                                                    title={
                                                        <Box>
                                                            {(company.directors || [])
                                                                .filter((d: any) => !d.resignedDate)
                                                                .map((d: any) => {
                                                                    const n = [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ') || d.name;
                                                                    return <Typography key={n} variant="caption" display="block" fontSize={11}>{n}</Typography>;
                                                                })}
                                                        </Box>
                                                    }
                                                    arrow
                                                    disableHoverListener={(company.directors || []).filter((d: any) => !d.resignedDate).length === 0}
                                                >
                                                    <Chip
                                                        label={(company.directors || []).filter((d: any) => !d.resignedDate).length}
                                                        size="small"
                                                        variant="outlined"
                                                        sx={{ height: 20, fontSize: 11, minWidth: 28, cursor: 'default' }}
                                                    />
                                                </Tooltip>
                                            </TableCell>

                                            <TableCell align="center" sx={{ py: 0.75 }}>
                                                <Tooltip
                                                    title={
                                                        <Box>
                                                            {(company.shareholders || []).map((s: any) => (
                                                                <Typography key={s.name + s.sharesClass} variant="caption" display="block" fontSize={11}>
                                                                    {s.name} · {s.numberOfShares?.toLocaleString()} {s.sharesClass}
                                                                </Typography>
                                                            ))}
                                                        </Box>
                                                    }
                                                    arrow
                                                    disableHoverListener={(company.shareholders || []).length === 0}
                                                >
                                                    <Chip
                                                        label={(company.shareholders || []).length}
                                                        size="small"
                                                        variant="outlined"
                                                        sx={{ height: 20, fontSize: 11, minWidth: 28, cursor: 'default' }}
                                                    />
                                                </Tooltip>
                                            </TableCell>

                                            <TableCell sx={{ py: 0.75 }}>
                                                <ComplianceBadge
                                                    c={comp}
                                                    onClick={() => navigate(`/records/${company._id}`)}
                                                />
                                            </TableCell>

                                            <TableCell align="right" sx={{ py: 0.75, pr: 1 }}>
                                                <Tooltip title="Records Vault" placement="top">
                                                    <IconButton size="small" onClick={() => navigate(`/records/${company._id}`)} sx={{ color: 'text.secondary', '&:hover': { color: '#2e7d32' } }}>
                                                        <ArchiveIcon sx={{ fontSize: 17 }} />
                                                    </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Documents" placement="top">
                                                    <IconButton size="small" onClick={() => navigate('/documents', { state: { companyId: company._id } })} sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}>
                                                        <FolderOpenIcon sx={{ fontSize: 17 }} />
                                                    </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Edit" placement="top">
                                                    <IconButton size="small" onClick={() => navigate(`/builder/${company._id}`)} sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}>
                                                        <EditIcon sx={{ fontSize: 17 }} />
                                                    </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Delete" placement="top">
                                                    <IconButton size="small" onClick={() => handleDelete(company._id, company.name)} sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}>
                                                        <DeleteIcon sx={{ fontSize: 17 }} />
                                                    </IconButton>
                                                </Tooltip>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>

                <Divider />
                <TablePagination
                    component="div"
                    count={filteredCompanies.length}
                    page={page}
                    onPageChange={(_, p) => setPage(p)}
                    rowsPerPage={rowsPerPage}
                    onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                    rowsPerPageOptions={[10, 25, 50]}
                    sx={{ fontSize: 12, '& .MuiTablePagination-toolbar': { minHeight: 40 } }}
                />
            </Paper>

            {/* ─── Recent Activity (subtle strip) ─────────────────────────────── */}
            <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'white', overflow: 'hidden' }}>
                <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" fontWeight={600} color="text.secondary" textTransform="uppercase" letterSpacing={0.5}>
                        Recent Activity
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                        — last {activity.length} actions
                    </Typography>
                </Box>
                <Box sx={{ px: 2, py: 1.25, overflowX: 'auto' }}>
                    {activity.length === 0 ? (
                        <Typography variant="caption" color="text.disabled">No activity yet.</Typography>
                    ) : (
                        <Stack direction="row" spacing={1.5} sx={{ minWidth: 'max-content' }}>
                            {activity.map((entry) => {
                                const dotColor = ACTION_COLORS[entry.action] || '#90a4ae';
                                return (
                                    <Box key={entry._id} sx={{
                                        display: 'flex', alignItems: 'flex-start', gap: 0.75,
                                        px: 1.25, py: 0.75, borderRadius: 1.5,
                                        bgcolor: '#f8f9fc', border: '1px solid', borderColor: 'divider',
                                        minWidth: 160, maxWidth: 220,
                                    }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dotColor, mt: 0.5, flexShrink: 0 }} />
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography variant="caption" fontWeight={500} fontSize={11} lineHeight={1.3} noWrap display="block" title={formatAction(entry.action)}>
                                                {formatAction(entry.action)}
                                            </Typography>
                                            <Typography variant="caption" color="text.disabled" fontSize={10} display="block">
                                                {formatRelative(entry.timestamp)}
                                            </Typography>
                                        </Box>
                                    </Box>
                                );
                            })}
                        </Stack>
                    )}
                </Box>
            </Paper>

            {/* Delete confirm dialog */}
            <Dialog open={deleteDialog.open} onClose={() => setDeleteDialog({ open: false, companyId: '', companyName: '' })}>
                <DialogTitle>Delete Company</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Delete <strong>{deleteDialog.companyName}</strong>? This cannot be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialog({ open: false, companyId: '', companyName: '' })}>Cancel</Button>
                    <Button onClick={confirmDelete} color="error" variant="contained">Delete</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default Dashboard;
