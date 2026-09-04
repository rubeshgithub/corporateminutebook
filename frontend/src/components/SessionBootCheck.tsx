import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import api from '../utils/api';
import { loginSuccess, logout } from '../store/authSlice';

/**
 * Boot-time session check.
 *
 * The SPA renders its signed-in shell from a localStorage cache of user
 * metadata so there is no flash of the landing page on reload. The cache
 * carries no credential, and it can outlive the httpOnly cookie: the cookie
 * expires after 30 days, the JWT secret can be rotated, the account can be
 * deleted from another device. Before this check the first sign of any of
 * that was a hard redirect from the 401 interceptor on the first API call
 * the user happened to make — often after they had already started typing.
 *
 * One GET /auth/me per page load. Success refreshes the cache; 401 or 404
 * signs the shell out (PrivateRoute then bounces to the landing page). A
 * network error keeps the cached shell — going offline is not a sign-out.
 */
const SessionBootCheck: React.FC = () => {
    const dispatch = useDispatch();
    const isAuthenticated = useSelector((state: any) => state.auth?.isAuthenticated);

    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;

        api.get('/auth/me')
            .then(({ data }) => {
                if (cancelled) return;
                dispatch(loginSuccess({ _id: data._id, name: data.name, email: data.email, role: data.role }));
            })
            .catch((err) => {
                if (cancelled) return;
                const status = err?.response?.status;
                if (status === 401 || status === 404) dispatch(logout());
            });

        return () => { cancelled = true; };
    // Deliberately runs once per page load — this is a boot check, not a
    // poll. Later sign-ins go through OtpForm, which sets the state itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return null;
};

export default SessionBootCheck;
