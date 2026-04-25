import React from 'react';
import { AppBar, Toolbar, Typography, Button, Box, Container } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../store/authSlice';

const NAV_ITEMS = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'New Company', path: '/builder' },
    { label: 'Documents', path: '/documents' },
];

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const dispatch = useDispatch();
    const { user } = useSelector((state: any) => state.auth);

    const handleLogout = () => {
        dispatch(logout());
        navigate('/login');
    };

    const isActive = (path: string) => {
        if (path === '/builder') return location.pathname === '/builder';
        return location.pathname === path || location.pathname.startsWith(`${path}/`);
    };

    return (
        <>
            <AppBar position="sticky">
                <Toolbar>
                    <Typography
                        variant="h6"
                        sx={{ mr: 4, cursor: 'pointer', fontWeight: 700, letterSpacing: 1 }}
                        onClick={() => navigate('/dashboard')}
                    >
                        MinuteBook
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        {NAV_ITEMS.map((item) => (
                            <Button
                                key={item.path}
                                color="inherit"
                                onClick={() => navigate(item.path)}
                                sx={{
                                    fontWeight: isActive(item.path) ? 700 : 400,
                                    borderBottom: isActive(item.path) ? '2px solid white' : '2px solid transparent',
                                    borderRadius: 0,
                                }}
                            >
                                {item.label}
                            </Button>
                        ))}
                    </Box>
                    <Box sx={{ flexGrow: 1 }} />
                    {user?.name && (
                        <Typography variant="body2" sx={{ mr: 2, opacity: 0.85 }}>
                            {user.name}
                        </Typography>
                    )}
                    <Button color="inherit" variant="outlined" onClick={handleLogout} sx={{ borderColor: 'rgba(255,255,255,0.5)' }}>
                        Logout
                    </Button>
                </Toolbar>
            </AppBar>
            <Container maxWidth={false} disableGutters>
                {children}
            </Container>
        </>
    );
};

export default Layout;
