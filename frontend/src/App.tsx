import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import Login from './components/Login';
import Landing from './components/Landing';
import Dashboard from './components/Dashboard';
import MinuteBookBuilder from './components/MinuteBookBuilder';
import DocumentManagement from './components/DocumentManagement';
import RecordsVault from './components/RecordsVault';
import SharedCompanyView from './components/SharedCompanyView';
import AccountPage from './components/AccountPage';
import SessionBootCheck from './components/SessionBootCheck';
import { PrivacyPolicy, TermsOfService } from './components/LegalPage';
import Layout from './components/Layout';
import { useSelector } from 'react-redux';
import { SnackbarProvider } from './context/SnackbarContext';

const EventsRedirect = () => {
    const { companyId } = useParams<{ companyId: string }>();
    return <Navigate to={`/records/${companyId}`} replace />;
};

const theme = createTheme({
    palette: {
        primary: {
            main: '#1a237e', // Deep blue for corporate feel
        },
        secondary: {
            main: '#c62828',
        },
        background: {
            default: '#f5f7fa',
        },
    },
    typography: {
        fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    },
});

const PrivateRoute = ({ children }: { children: JSX.Element }) => {
    const isAuthenticated = useSelector((state: any) => state.auth?.isAuthenticated);
    return isAuthenticated ? <Layout>{children}</Layout> : <Navigate to="/" />;
};

function App() {
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <SnackbarProvider>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                {/* Confirms the cached sign-in against the server once per
                    page load; signs the shell out if the cookie is gone. */}
                <SessionBootCheck />
                <Routes>
                    <Route path="/" element={<Landing />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Navigate to="/login" />} />
                    <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
                    <Route path="/builder" element={<PrivateRoute><MinuteBookBuilder /></PrivateRoute>} />
                    <Route path="/builder/:id" element={<PrivateRoute><MinuteBookBuilder /></PrivateRoute>} />
                    <Route path="/documents" element={<PrivateRoute><DocumentManagement /></PrivateRoute>} />
                    <Route path="/events/:companyId" element={<EventsRedirect />} />
                    <Route path="/records/:companyId" element={<PrivateRoute><RecordsVault /></PrivateRoute>} />
                    <Route path="/account" element={<PrivateRoute><AccountPage /></PrivateRoute>} />
                    {/* Public read-only share view — no auth. The token IS
                        the credential; backend enforces expiry + revoke. */}
                    <Route path="/share/:token" element={<SharedCompanyView />} />
                    <Route path="/privacy" element={<PrivacyPolicy />} />
                    <Route path="/terms" element={<TermsOfService />} />
                </Routes>
            </BrowserRouter>
            </SnackbarProvider>
        </ThemeProvider>
    );
}

export default App;
