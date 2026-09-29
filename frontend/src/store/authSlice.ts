import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/**
 * The auth token no longer lives in Redux or localStorage — it's an httpOnly
 * cookie set by the backend on OTP verify. This slice only holds the user's
 * public metadata so the SPA can render the shell without a boot-time
 * roundtrip. If the cookie is missing/expired, api.ts's 401 interceptor
 * clears this cache and bounces to the landing page.
 */
export interface AuthOrganization {
    _id: string;
    name: string;
    role: 'supervisor' | 'member';
}

interface AuthUser {
    _id: string;
    name: string;
    email: string;
    role: string;
    // The firm this user works in, or null for a solo account.
    organization?: AuthOrganization | null;
}

interface AuthState {
    user: AuthUser | null;
    isAuthenticated: boolean;
}

const loadInitialState = (): AuthState => {
    try {
        const userString = localStorage.getItem('user');
        if (userString) {
            const user = JSON.parse(userString);
            // Reject any legacy shape that still carries a token — that's a
            // pre-migration cache and needs to be evicted before it leaks
            // anywhere. Fresh sessions store no token client-side.
            if (user && user._id && !user.token) {
                return { user, isAuthenticated: true };
            }
            localStorage.removeItem('user');
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
        loginSuccess: (state, action: PayloadAction<AuthUser>) => {
            state.user = action.payload;
            state.isAuthenticated = true;
            localStorage.setItem('user', JSON.stringify(action.payload));
        },
        logout: (state) => {
            state.user = null;
            state.isAuthenticated = false;
            localStorage.removeItem('user');
        },
        setOrganization: (state, action: PayloadAction<AuthOrganization | null>) => {
            if (!state.user) return;
            state.user.organization = action.payload;
            localStorage.setItem('user', JSON.stringify(state.user));
        },
    },
});

export const { loginSuccess, logout, setOrganization } = authSlice.actions;
export default authSlice.reducer;
