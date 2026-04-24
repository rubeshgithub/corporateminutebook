import React, { useState } from 'react';
import { Box, Button, TextField, Typography, Paper } from '@mui/material';
import { useDispatch } from 'react-redux';
import { loginSuccess } from '../store/authSlice';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const Register: React.FC = () => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await axios.post('/api/auth/register', { name, email, password });
            dispatch(loginSuccess(res.data));
            navigate('/dashboard');
        } catch (error) {
            console.error('Registration failed', error);
            alert('Registration Failed');
        }
    };

    return (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
            <Paper elevation={3} sx={{ padding: 4, width: '100%', maxWidth: 400 }}>
                <Typography variant="h5" align="center" gutterBottom>
                    Register for MinuteBook
                </Typography>
                <form onSubmit={handleRegister}>
                    <TextField
                        fullWidth
                        label="Name"
                        margin="normal"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
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
                        Register
                    </Button>
                    <Button fullWidth variant="text" onClick={() => navigate('/login')} sx={{ mt: 1 }}>
                        Already have an account? Login
                    </Button>
                </form>
            </Paper>
        </Box>
    );
};

export default Register;
