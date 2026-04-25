import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AuthState {
    user: { _id: string; name: string; email: string; role: string; token: string } | null;
    isAuthenticated: boolean;
}

const loadInitialState = (): AuthState => {
    try {
        const userString = localStorage.getItem('user');
        if (userString) {
            const user = JSON.parse(userString);
            if (user && user.token) {
                return { user, isAuthenticated: true };
            }
        }
    } catch {
        localStorage.removeItem('user');
    }
    return { user: null, isAuthenticated: false };
};

const initialState: AuthState = loadInitialState();

const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        loginSuccess: (state, action: PayloadAction<any>) => {
            state.user = action.payload;
            state.isAuthenticated = true;
            localStorage.setItem('user', JSON.stringify(action.payload));
        },
        logout: (state) => {
            state.user = null;
            state.isAuthenticated = false;
            localStorage.removeItem('user');
        },
    },
});

export const { loginSuccess, logout } = authSlice.actions;
export default authSlice.reducer;
