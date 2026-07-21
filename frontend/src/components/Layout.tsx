import React from 'react';
import { AppBar, Toolbar, Typography, Button, Box, Container } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../store/authSlice';
import LandingFooter from './LandingFooter';
import api from '../utils/api';

const NAV_ITEMS = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'New Company', path: '/builder' },
    { label: 'Documents', path: '/documents' },
];

const CrsBrandStrip: React.FC = () => (
    <div
        style={{
            background: '#0C3D61',
            color: '#fff',
            fontSize: '0.72rem',
            fontWeight: 500,
            padding: '0.35rem 1.5rem',
            textAlign: 'center',
            letterSpacing: '0.01em',
        }}
    >
        A service of{' '}
        <a
            href="https://www.corporateregistryservices.ca"
            style={{ color: '#C8952A', fontWeight: 600, textDecoration: 'none' }}
        >
            Corporate Registry Services
        </a>
        <span style={{ opacity: 0.65, marginLeft: '0.4rem' }}>
            — Canadian federal &amp; all 13 provincial registries
        </span>
    </div>
);

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const dispatch = useDispatch();
    const { user } = useSelector((state: any) => state.auth);

    const handleLogout = async () => {
        // Fire-and-forget — even if the network call fails, we still clear
        // client-side state so the visitor doesn't see a stuck-signed-in
        // shell. The httpOnly cookie is server-cleared here; if the request
        // never lands, the cookie expires on its own after 30 days.
        try { await api.post('/auth/logout'); } catch { /* network noop */ }
        dispatch(logout());
        navigate('/');
    };

    const isActive = (path: string) => {
        if (path === '/builder') return location.pathname === '/builder';
        return location.pathname === path || location.pathname.startsWith(`${path}/`);
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <CrsBrandStrip />
            <AppBar
                position="sticky"
                elevation={0}
                sx={{
                    background: '#fff',
                    color: '#0C3D61',
                    borderBottom: '1px solid #E5E7EB',
                    top: 0,
                }}
            >
                <Toolbar>
                    {/* Brand */}
                    <Box
                        sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mr: 4, cursor: 'pointer' }}
                        onClick={() => navigate('/dashboard')}
                    >
                        <svg width="28" height="28" viewBox="0 0 100 100" aria-hidden="true">
                            <rect width="100" height="100" rx="16" fill="#0C3D61" />
                            <path
                                fill="#C8952A"
                                d="M50,9 L53,21 L64,14 L59,27 L73,25 L64,34 L79,40 L66,45 L72,59 L56,52 L54,69 L53,84 L47,84 L46,69 L44,52 L28,59 L34,45 L21,40 L36,34 L27,25 L41,27 L36,14 L47,21 Z"
                            />
                        </svg>
                        <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
                            <Typography
                                sx={{
                                    fontFamily: 'Georgia, serif',
                                    fontSize: '1.1rem',
                                    fontWeight: 700,
                                    color: '#0C3D61',
                                }}
                            >
                                MinuteBook
                            </Typography>
                            <Typography
                                sx={{
                                    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                                    fontSize: '0.58rem',
                                    fontWeight: 600,
                                    color: '#C8952A',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.1em',
                                    mt: '0.15rem',
                                }}
                            >
                                by CRS
                            </Typography>
                        </Box>
                    </Box>

                    {/* In-app nav */}
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {NAV_ITEMS.map((item) => (
                            <Button
                                key={item.path}
                                onClick={() => navigate(item.path)}
                                sx={{
                                    color: '#0C3D61',
                                    fontWeight: isActive(item.path) ? 700 : 500,
                                    fontSize: '0.875rem',
                                    textTransform: 'none',
                                    borderBottom: isActive(item.path) ? '2px solid #C8952A' : '2px solid transparent',
                                    borderRadius: 0,
                                    px: 1.5,
                                    '&:hover': { background: 'rgba(12,61,97,0.06)' },
                                }}
                            >
                                {item.label}
                            </Button>
                        ))}
                    </Box>

                    <Box sx={{ flexGrow: 1 }} />

                    {user?.email && (
                        <Typography
                            sx={{
                                fontSize: '0.82rem',
                                color: '#64748b',
                                mr: 2,
                                display: { xs: 'none', sm: 'block' },
                            }}
                        >
                            {user.email}
                        </Typography>
                    )}
                    <Button
                        onClick={handleLogout}
                        variant="outlined"
                        sx={{
                            borderColor: '#0C3D61',
                            color: '#0C3D61',
                            fontWeight: 600,
                            fontSize: '0.82rem',
                            textTransform: 'none',
                            '&:hover': { background: '#0C3D61', color: '#fff', borderColor: '#0C3D61' },
                        }}
                    >
                        Sign out
                    </Button>
                </Toolbar>
            </AppBar>

            <Container maxWidth={false} disableGutters sx={{ flex: 1 }}>
                {children}
            </Container>

            <LandingFooter />
        </Box>
    );
};

export default Layout;
