import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import MinuteBookBuilder from './components/MinuteBookBuilder';
import DocumentManagement from './components/DocumentManagement';
import { useSelector } from 'react-redux';
import { RootState } from './store/store';

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
    return isAuthenticated ? children : <Navigate to="/login" />;
};

function App() {
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Routes>
                    <Route path="/" element={<Navigate to="/login" />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
                    <Route path="/builder" element={<PrivateRoute><MinuteBookBuilder /></PrivateRoute>} />
                    <Route path="/documents" element={<PrivateRoute><DocumentManagement /></PrivateRoute>} />
                </Routes>
            </BrowserRouter>
        </ThemeProvider>
    );
}

export default App;
