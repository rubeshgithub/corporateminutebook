import axios from 'axios';

/**
 * Auth is now cookie-based (httpOnly). We flip withCredentials on so the
 * browser attaches the mb_auth cookie on every request. There's no token
 * to inject — that whole XSS-vulnerable path is gone.
 *
 * localStorage still holds a cache of user metadata (name, email, role)
 * so the SPA can render the shell without a boot-time roundtrip, but it
 * carries NO credential.
 */
const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,
});

// On 401 the cookie is missing/expired — clear the user cache and bounce.
// GET /api/auth/me itself is allowed to 401 on boot without redirecting
// (the app just stays unauthenticated); everything else does a hard redirect.
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error.response?.status;
        const url = error.config?.url ?? '';
        if (status === 401 && !url.endsWith('/auth/me')) {
            if (localStorage.getItem('user')) localStorage.removeItem('user');
            if (window.location.pathname !== '/' && window.location.pathname !== '/login') {
                window.location.href = '/';
            }
        }
        return Promise.reject(error);
    },
);

export default api;
