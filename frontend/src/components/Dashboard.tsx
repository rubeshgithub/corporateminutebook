import React from 'react';
import {
    Box, Typography, Button, Paper, Grid, List, ListItem, ListItemText, IconButton,
    TextField, InputAdornment, Card, CardContent
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import BusinessIcon from '@mui/icons-material/Business';
import DescriptionIcon from '@mui/icons-material/Description';
import GroupIcon from '@mui/icons-material/Group';
import PieChartIcon from '@mui/icons-material/PieChart';
import TimelineIcon from '@mui/icons-material/Timeline';
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

const StatCard: React.FC<{ label: string; value: number | string; icon: React.ReactNode; gradient: string }> = ({ label, value, icon, gradient }) => (
    <Card sx={{ height: '100%', position: 'relative', overflow: 'hidden', borderRadius: 2 }}>
        <Box sx={{ position: 'absolute', inset: 0, background: gradient, opacity: 0.95 }} />
        <CardContent sx={{ position: 'relative', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 2.5 }}>
            <Box>
                <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 1, opacity: 0.85 }}>
                    {label}
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 700, mt: 0.5 }}>
                    {value}
                </Typography>
            </Box>
            <Box sx={{ opacity: 0.55, '& svg': { fontSize: 56 } }}>{icon}</Box>
        </CardContent>
    </Card>
);

const Dashboard: React.FC = () => {
    const navigate = useNavigate();
    const [companies, setCompanies] = React.useState<any[]>([]);
    const [activity, setActivity] = React.useState<any[]>([]);
    const [stats, setStats] = React.useState<Stats | null>(null);
    const [search, setSearch] = React.useState('');

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
            const { data } = await api.get('/activity', { params: { limit: 10 } });
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

    const formatAction = (action: string) =>
        action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

    const handleDelete = async (companyId: string, companyName: string) => {
        if (!window.confirm(`Delete "${companyName}"? You can restore it from the database; the company will be hidden from this view.`)) {
            return;
        }
        try {
            await api.delete(`/companies/${companyId}`);
            setCompanies((prev) => prev.filter((c) => c._id !== companyId));
            fetchStats();
        } catch (error) {
            console.error('Failed to delete company:', error);
            alert('Failed to delete company.');
        }
    };

    const filteredCompanies = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return companies;
        return companies.filter((c) =>
            (c.name || '').toLowerCase().includes(q) ||
            (c.corporateAccessNumber || '').toLowerCase().includes(q) ||
            (c.businessNumber || '').toLowerCase().includes(q)
        );
    }, [companies, search]);

    return (
        <Box p={4}>
            <Typography variant="h4" mb={3}>Corporate Dashboard</Typography>

            <Grid container spacing={2} mb={4}>
                <Grid item xs={12} sm={6} md={4} lg={2}>
                    <StatCard label="Companies" value={stats?.companies ?? '—'} icon={<BusinessIcon />} gradient="linear-gradient(135deg, #1a237e, #283593)" />
                </Grid>
                <Grid item xs={12} sm={6} md={4} lg={2}>
                    <StatCard label="Documents" value={stats?.documents ?? '—'} icon={<DescriptionIcon />} gradient="linear-gradient(135deg, #00695c, #00897b)" />
                </Grid>
                <Grid item xs={12} sm={6} md={4} lg={2}>
                    <StatCard label="Directors" value={stats?.directors ?? '—'} icon={<GroupIcon />} gradient="linear-gradient(135deg, #4527a0, #5e35b1)" />
                </Grid>
                <Grid item xs={12} sm={6} md={4} lg={2}>
                    <StatCard label="Shareholders" value={stats?.shareholders ?? '—'} icon={<PieChartIcon />} gradient="linear-gradient(135deg, #c62828, #ad1457)" />
                </Grid>
                <Grid item xs={12} sm={6} md={4} lg={2}>
                    <StatCard label="Shares Issued" value={stats?.sharesIssued ?? '—'} icon={<PieChartIcon />} gradient="linear-gradient(135deg, #ef6c00, #d84315)" />
                </Grid>
                <Grid item xs={12} sm={6} md={4} lg={2}>
                    <StatCard label="Activity (7d)" value={stats?.activityLast7Days ?? '—'} icon={<TimelineIcon />} gradient="linear-gradient(135deg, #455a64, #607d8b)" />
                </Grid>
            </Grid>

            <Grid container spacing={4}>
                <Grid item xs={12} md={7}>
                    <Paper elevation={3} sx={{ p: 3, minHeight: 300 }}>
                        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={2}>
                            <Typography variant="h6">My Companies</Typography>
                            <TextField
                                size="small"
                                placeholder="Search by name, CAN or BN…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                sx={{ width: 280 }}
                                InputProps={{
                                    startAdornment: (
                                        <InputAdornment position="start">
                                            <SearchIcon fontSize="small" />
                                        </InputAdornment>
                                    ),
                                }}
                            />
                        </Box>
                        {companies.length === 0 ? (
                            <Typography variant="body2" color="textSecondary">
                                You haven't added any companies yet.
                            </Typography>
                        ) : filteredCompanies.length === 0 ? (
                            <Typography variant="body2" color="textSecondary">
                                No companies match "{search}".
                            </Typography>
                        ) : (
                            <List>
                                {filteredCompanies.map((company) => (
                                    <ListItem
                                        key={company._id}
                                        secondaryAction={
                                            <Box>
                                                <IconButton
                                                    edge="end"
                                                    aria-label="edit"
                                                    onClick={() => navigate(`/builder/${company._id}`)}
                                                    color="primary"
                                                >
                                                    <EditIcon />
                                                </IconButton>
                                                <IconButton
                                                    edge="end"
                                                    aria-label="delete"
                                                    onClick={() => handleDelete(company._id, company.name)}
                                                    color="error"
                                                >
                                                    <DeleteIcon />
                                                </IconButton>
                                            </Box>
                                        }
                                    >
                                        <ListItemText primary={company.name} secondary={`CAN: ${company.corporateAccessNumber || 'N/A'}`} />
                                    </ListItem>
                                ))}
                            </List>
                        )}
                        <Box display="flex" gap={2} mt={3}>
                            <Button variant="contained" color="primary" onClick={() => navigate('/builder')}>
                                + New Minute Book
                            </Button>
                            <Button variant="outlined" color="primary" onClick={() => navigate('/documents')}>
                                Go to Document Vault
                            </Button>
                        </Box>
                    </Paper>
                </Grid>
                <Grid item xs={12} md={5}>
                    <Paper elevation={3} sx={{ p: 3, minHeight: 300 }}>
                        <Typography variant="h6" gutterBottom>
                            Recent Activity
                        </Typography>
                        {activity.length === 0 ? (
                            <Typography variant="body2" color="textSecondary">
                                No recent activity found.
                            </Typography>
                        ) : (
                            <List dense>
                                {activity.map((entry) => (
                                    <ListItem key={entry._id} disableGutters>
                                        <ListItemText
                                            primary={formatAction(entry.action)}
                                            secondary={`${entry.details || ''}${entry.details ? ' — ' : ''}${new Date(entry.timestamp).toLocaleString()}`}
                                        />
                                    </ListItem>
                                ))}
                            </List>
                        )}
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default Dashboard;
