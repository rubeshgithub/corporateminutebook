import React from 'react';
import { Box, Typography, Button, Paper, Grid, List, ListItem, ListItemText, IconButton } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../utils/api';
import { useNavigate } from 'react-router-dom';

const Dashboard: React.FC = () => {
    const navigate = useNavigate();
    const [companies, setCompanies] = React.useState<any[]>([]);
    const [activity, setActivity] = React.useState<any[]>([]);

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

    React.useEffect(() => {
        fetchCompanies();
        fetchActivity();
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
        } catch (error) {
            console.error('Failed to delete company:', error);
            alert('Failed to delete company.');
        }
    };

    return (
        <Box p={4}>
            <Typography variant="h4" mb={4}>Corporate Dashboard</Typography>

            <Grid container spacing={4}>
                <Grid item xs={12} md={6}>
                    <Paper elevation={3} sx={{ p: 3, minHeight: 200 }}>
                        <Typography variant="h6" gutterBottom>
                            My Companies
                        </Typography>
                        {companies.length === 0 ? (
                            <Typography variant="body2" color="textSecondary">
                                You haven't added any companies yet.
                            </Typography>
                        ) : (
                            <List>
                                {companies.map((company) => (
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
                <Grid item xs={12} md={6}>
                    <Paper elevation={3} sx={{ p: 3, minHeight: 200 }}>
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
