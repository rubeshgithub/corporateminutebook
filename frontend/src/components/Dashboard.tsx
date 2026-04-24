import React from 'react';
import { Box, Typography, Button, Paper, Grid, List, ListItem, ListItemText } from '@mui/material';
import api from '../utils/api';
import { useSelector, useDispatch } from 'react-redux';
import { logout } from '../store/authSlice';
import { useNavigate } from 'react-router-dom';

const Dashboard: React.FC = () => {
    const { user } = useSelector((state: any) => state.auth);
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [companies, setCompanies] = React.useState<any[]>([]);

    React.useEffect(() => {
        const fetchCompanies = async () => {
            try {
                const { data } = await api.get('/companies');
                setCompanies(data);
            } catch (error) {
                console.error('Error fetching companies:', error);
            }
        };
        fetchCompanies();
    }, []);

    const handleLogout = () => {
        dispatch(logout());
        navigate('/login');
    };

    return (
        <Box p={4}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
                <Typography variant="h4">Corporate Dashboard</Typography>
                <Box>
                    <Typography variant="subtitle1" display="inline" mr={2}>
                        Welcome, {user?.name}
                    </Typography>
                    <Button variant="outlined" color="secondary" onClick={handleLogout}>
                        Logout
                    </Button>
                </Box>
            </Box>

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
                                    <ListItem key={company._id}>
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
                        <Typography variant="body2" color="textSecondary">
                            No recent activity found.
                        </Typography>
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default Dashboard;
