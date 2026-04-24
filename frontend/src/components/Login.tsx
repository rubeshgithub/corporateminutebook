import React, { useState } from 'react';
import { Box, Button, TextField, Typography, Paper } from '@mui/material';
import { useDispatch } from 'react-redux';
import { loginSuccess } from '../store/authSlice';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await axios.post('/api/auth/login', { email, password });
            dispatch(loginSuccess(res.data));
            navigate('/dashboard');
        } catch (error) {
            console.error('Login failed', error);
            alert('Login Failed');
        }
    };

    return (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
            <Paper elevation={3} sx={{ padding: 4, width: '100%', maxWidth: 400 }}>
                <Typography variant="h5" align="center" gutterBottom>
                    Login to MinuteBook
                </Typography>
                <form onSubmit={handleLogin}>
                    <TextField
                        fullWidth
                        label="Email"
                        margin="normal"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                    <TextField
                        fullWidth
                        label="Password"
                        type="password"
                        margin="normal"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                    <Button fullWidth variant="contained" color="primary" type="submit" sx={{ mt: 2 }}>
                        Login
                    </Button>
                    <Button fullWidth variant="text" onClick={() => navigate('/register')} sx={{ mt: 1 }}>
                        Don't have an account? Register
                    </Button>
                </form>
            </Paper>
        </Box>
    );
};

export default Login;
