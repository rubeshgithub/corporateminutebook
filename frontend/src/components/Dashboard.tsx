import React from 'react';
import {
    Box, Typography, Button, Paper, Grid, IconButton, TextField, InputAdornment,
    Avatar, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    TablePagination, TableSortLabel, Tooltip, Chip, Stack, Divider
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
import api from '../utils/api';
import { useNavigate } from 'react-router-dom';

interface Stats {
    companies: number;
    documents: number;
    directors: number;
    shareholders: number;
    sharesIssued: number;
    activityLast7Days: number;
}

type Order = 'asc' | 'desc';
type OrderBy = 'name' | 'incorporationDate' | 'directors' | 'shareholders';

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
};

const Dashboard: React.FC = () => {
    const navigate = useNavigate();
    const [companies, setCompanies] = React.useState<any[]>([]);
    const [activity, setActivity] = React.useState<any[]>([]);
    const [stats, setStats] = React.useState<Stats | null>(null);
    const [search, setSearch] = React.useState('');
    const [page, setPage] = React.useState(0);
    const [rowsPerPage, setRowsPerPage] = React.useState(10);
    const [order, setOrder] = React.useState<Order>('asc');
    const [orderBy, setOrderBy] = React.useState<OrderBy>('name');

    const fetchCompanies = async () => {
        try {
            const { data } = await api.get('/companies');
            setCompanies(data);
        } catch (error) {
            console.error('Error fetching companies:', error);
        }
    };

    const fetchActivity = async () => {
        try {
            const { data } = await api.get('/activity', { params: { limit: 12 } });
            setActivity(data);
        } catch (error) {
            console.error('Error fetching activity:', error);
        }
    };

    const fetchStats = async () => {
        try {
            const { data } = await api.get('/stats');
            setStats(data);
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    };

    React.useEffect(() => {
        fetchCompanies();
        fetchActivity();
        fetchStats();
    }, []);

    const handleDelete = async (companyId: string, companyName: string) => {
        if (!window.confirm(`Delete "${companyName}"? The company will be hidden from this view.`)) return;
        try {
            await api.delete(`/companies/${companyId}`);
            setCompanies((prev) => prev.filter((c) => c._id !== companyId));
            fetchStats();
        } catch (error) {
            console.error('Failed to delete company:', error);
            alert('Failed to delete company.');
        }
    };

    const handleSort = (col: OrderBy) => {
        if (orderBy === col) {
            setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
        } else {
            setOrderBy(col);
            setOrder('asc');
        }
        setPage(0);
    };

    const filteredCompanies = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return companies;
        return companies.filter(
            (c) =>
                (c.name || '').toLowerCase().includes(q) ||
                (c.corporateAccessNumber || '').toLowerCase().includes(q) ||
                (c.businessNumber || '').toLowerCase().includes(q)
        );
    }, [companies, search]);

    const sortedCompanies = React.useMemo(() => {
        return [...filteredCompanies].sort((a, b) => {
            let av: any, bv: any;
            if (orderBy === 'name') { av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); }
            else if (orderBy === 'incorporationDate') { av = a.incorporationDate ? new Date(a.incorporationDate).getTime() : 0; bv = b.incorporationDate ? new Date(b.incorporationDate).getTime() : 0; }
            else if (orderBy === 'directors') { av = a.directors?.length ?? 0; bv = b.directors?.length ?? 0; }
            else { av = a.shareholders?.length ?? 0; bv = b.shareholders?.length ?? 0; }
            return order === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
        });
    }, [filteredCompanies, order, orderBy]);

    const paginatedCompanies = sortedCompanies.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

    const statItems = [
        { label: 'Companies', value: stats?.companies ?? '—', icon: <BusinessIcon sx={{ fontSize: 18 }} />, color: '#1a237e' },
        { label: 'Documents', value: stats?.documents ?? '—', icon: <DescriptionIcon sx={{ fontSize: 18 }} />, color: '#1565c0' },
        { label: 'Directors', value: stats?.directors ?? '—', icon: <GroupIcon sx={{ fontSize: 18 }} />, color: '#4527a0' },
        { label: 'Shareholders', value: stats?.shareholders ?? '—', icon: <PieChartIcon sx={{ fontSize: 18 }} />, color: '#c62828' },
        { label: 'Shares Issued', value: stats?.sharesIssued ?? '—', icon: <ShareIcon sx={{ fontSize: 18 }} />, color: '#ef6c00' },
        { label: 'Activity (7d)', value: stats?.activityLast7Days ?? '—', icon: <TimelineIcon sx={{ fontSize: 18 }} />, color: '#2e7d32' },
    ];

    return (
        <Box sx={{ p: 3, bgcolor: '#f5f6fa', minHeight: '100vh' }}>

            {/* Page header */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
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

            {/* Stats strip */}
            <Grid container spacing={1.5} mb={3}>
                {statItems.map((s) => (
                    <Grid item xs={6} sm={4} md={2} key={s.label}>
                        <Paper
                            elevation={0}
                            sx={{
                                p: 1.5,
                                borderRadius: 2,
                                border: '1px solid',
                                borderColor: 'divider',
                                borderLeft: `4px solid ${s.color}`,
                                bgcolor: 'white',
                            }}
                        >
                            <Box display="flex" alignItems="center" gap={0.8} mb={0.3}>
                                <Box sx={{ color: s.color }}>{s.icon}</Box>
                                <Typography variant="caption" color="text.secondary" fontWeight={500}>
                                    {s.label}
                                </Typography>
                            </Box>
                            <Typography variant="h6" fontWeight={700} lineHeight={1}>
                                {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
                            </Typography>
                        </Paper>
                    </Grid>
                ))}
            </Grid>

            {/* Main content */}
            <Grid container spacing={2}>

                {/* Companies table */}
                <Grid item xs={12} md={8}>
                    <Paper
                        elevation={0}
                        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'white', overflow: 'hidden' }}
                    >
                        {/* Table toolbar */}
                        <Box
                            sx={{
                                px: 2, py: 1.5,
                                display: 'flex', alignItems: 'center', gap: 1.5,
                                borderBottom: '1px solid', borderColor: 'divider',
                            }}
                        >
                            <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
                                Companies
                                {filteredCompanies.length > 0 && (
                                    <Chip
                                        label={filteredCompanies.length}
                                        size="small"
                                        sx={{ ml: 1, height: 18, fontSize: 11 }}
                                    />
                                )}
                            </Typography>
                            <TextField
                                size="small"
                                placeholder="Search by name, CAN or BN…"
                                value={search}
                                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                                sx={{ width: 240, '& .MuiOutlinedInput-root': { fontSize: 13 } }}
                                InputProps={{
                                    startAdornment: (
                                        <InputAdornment position="start">
                                            <SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                                        </InputAdornment>
                                    ),
                                }}
                            />
                        </Box>

                        {/* Table */}
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow sx={{ bgcolor: '#fafafa' }}>
                                        <TableCell sx={{ width: 44, py: 1 }} />
                                        <TableCell sx={{ py: 1, fontWeight: 600, fontSize: 12 }}>
                                            <TableSortLabel
                                                active={orderBy === 'name'}
                                                direction={orderBy === 'name' ? order : 'asc'}
                                                onClick={() => handleSort('name')}
                                            >
                                                Company
                                            </TableSortLabel>
                                        </TableCell>
                                        <TableCell sx={{ py: 1, fontWeight: 600, fontSize: 12 }}>
                                            <TableSortLabel
                                                active={orderBy === 'incorporationDate'}
                                                direction={orderBy === 'incorporationDate' ? order : 'asc'}
                                                onClick={() => handleSort('incorporationDate')}
                                            >
                                                Incorporated
                                            </TableSortLabel>
                                        </TableCell>
                                        <TableCell align="center" sx={{ py: 1, fontWeight: 600, fontSize: 12 }}>
                                            <TableSortLabel
                                                active={orderBy === 'directors'}
                                                direction={orderBy === 'directors' ? order : 'asc'}
                                                onClick={() => handleSort('directors')}
                                            >
                                                Dir.
                                            </TableSortLabel>
                                        </TableCell>
                                        <TableCell align="center" sx={{ py: 1, fontWeight: 600, fontSize: 12 }}>
                                            <TableSortLabel
                                                active={orderBy === 'shareholders'}
                                                direction={orderBy === 'shareholders' ? order : 'asc'}
                                                onClick={() => handleSort('shareholders')}
                                            >
                                                S/H
                                            </TableSortLabel>
                                        </TableCell>
                                        <TableCell align="right" sx={{ py: 1, fontWeight: 600, fontSize: 12 }}>
                                            Actions
                                        </TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {paginatedCompanies.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary', fontSize: 13 }}>
                                                {search
                                                    ? `No companies match "${search}"`
                                                    : 'No companies yet — create your first one.'}
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        paginatedCompanies.map((company) => (
                                            <TableRow
                                                key={company._id}
                                                hover
                                                sx={{ cursor: 'default', '&:last-child td': { borderBottom: 0 } }}
                                            >
                                                <TableCell sx={{ py: 0.75, pl: 1.5 }}>
                                                    <Avatar
                                                        sx={{
                                                            width: 30, height: 30, fontSize: 11, fontWeight: 700,
                                                            bgcolor: getAvatarColor(company.name),
                                                        }}
                                                    >
                                                        {getInitials(company.name)}
                                                    </Avatar>
                                                </TableCell>
                                                <TableCell sx={{ py: 0.75 }}>
                                                    <Typography variant="body2" fontWeight={600} lineHeight={1.3}>
                                                        {company.name}
                                                    </Typography>
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
                                                </TableCell>
                                                <TableCell align="center" sx={{ py: 0.75 }}>
                                                    <Chip
                                                        label={company.directors?.length ?? 0}
                                                        size="small"
                                                        variant="outlined"
                                                        sx={{ height: 20, fontSize: 11, minWidth: 28 }}
                                                    />
                                                </TableCell>
                                                <TableCell align="center" sx={{ py: 0.75 }}>
                                                    <Chip
                                                        label={company.shareholders?.length ?? 0}
                                                        size="small"
                                                        variant="outlined"
                                                        sx={{ height: 20, fontSize: 11, minWidth: 28 }}
                                                    />
                                                </TableCell>
                                                <TableCell align="right" sx={{ py: 0.75, pr: 1 }}>
                                                    <Tooltip title="Documents" placement="top">
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => navigate('/documents')}
                                                            sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
                                                        >
                                                            <FolderOpenIcon sx={{ fontSize: 17 }} />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title="Edit" placement="top">
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => navigate(`/builder/${company._id}`)}
                                                            sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
                                                        >
                                                            <EditIcon sx={{ fontSize: 17 }} />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title="Delete" placement="top">
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => handleDelete(company._id, company.name)}
                                                            sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                                                        >
                                                            <DeleteIcon sx={{ fontSize: 17 }} />
                                                        </IconButton>
                                                    </Tooltip>
                                                </TableCell>
                                            </TableRow>
                                        ))
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
                            onRowsPerPageChange={(e) => {
                                setRowsPerPage(parseInt(e.target.value, 10));
                                setPage(0);
                            }}
                            rowsPerPageOptions={[10, 25, 50]}
                            sx={{ fontSize: 12, '& .MuiTablePagination-toolbar': { minHeight: 44 } }}
                        />
                    </Paper>
                </Grid>

                {/* Activity feed */}
                <Grid item xs={12} md={4}>
                    <Paper
                        elevation={0}
                        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'white', overflow: 'hidden' }}
                    >
                        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                            <Typography variant="subtitle1" fontWeight={600}>Recent Activity</Typography>
                        </Box>
                        <Box sx={{ p: 2 }}>
                            {activity.length === 0 ? (
                                <Typography variant="body2" color="text.secondary">No recent activity.</Typography>
                            ) : (
                                <Stack spacing={0}>
                                    {activity.map((entry, i) => {
                                        const dotColor = ACTION_COLORS[entry.action] || '#90a4ae';
                                        const isLast = i === activity.length - 1;
                                        return (
                                            <Box key={entry._id} display="flex" gap={1.5} sx={{ pb: isLast ? 0 : 2, position: 'relative' }}>
                                                {!isLast && (
                                                    <Box sx={{
                                                        position: 'absolute', left: 6, top: 14,
                                                        bottom: 0, width: '1px', bgcolor: 'divider',
                                                    }} />
                                                )}
                                                <Box sx={{
                                                    width: 13, height: 13, borderRadius: '50%',
                                                    bgcolor: dotColor, flexShrink: 0, mt: 0.4,
                                                    border: '2px solid white',
                                                    boxShadow: `0 0 0 1px ${dotColor}`,
                                                }} />
                                                <Box sx={{ minWidth: 0 }}>
                                                    <Typography variant="body2" fontWeight={500} fontSize={12} lineHeight={1.4}>
                                                        {formatAction(entry.action)}
                                                    </Typography>
                                                    {entry.details && (
                                                        <Typography
                                                            variant="caption"
                                                            color="text.secondary"
                                                            display="block"
                                                            sx={{ lineHeight: 1.4, mt: 0.2, mb: 0.3 }}
                                                            noWrap
                                                            title={entry.details}
                                                        >
                                                            {entry.details}
                                                        </Typography>
                                                    )}
                                                    <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 11 }}>
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
                </Grid>

            </Grid>
        </Box>
    );
};

export default Dashboard;
