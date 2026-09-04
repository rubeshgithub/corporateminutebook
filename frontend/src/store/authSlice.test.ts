import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The slice computes its initial state from localStorage at import time, so
 * each boot-behaviour test re-imports a fresh copy of the module.
 */
async function freshSlice() {
    vi.resetModules();
    return import('./authSlice');
}

const user = { _id: 'u1', name: 'Jane', email: 'jane@example.ca', role: 'business_owner' };

describe('authSlice boot', () => {
    beforeEach(() => localStorage.clear());

    it('starts signed out with empty storage', async () => {
        const { default: reducer } = await freshSlice();
        const state = reducer(undefined, { type: '@@INIT' });
        expect(state).toEqual({ user: null, isAuthenticated: false });
    });

    it('hydrates from a cached user that carries no token', async () => {
        localStorage.setItem('user', JSON.stringify(user));
        const { default: reducer } = await freshSlice();
        const state = reducer(undefined, { type: '@@INIT' });
        expect(state.isAuthenticated).toBe(true);
        expect(state.user).toEqual(user);
    });

    it('evicts a pre-migration cache that still carries a token', async () => {
        localStorage.setItem('user', JSON.stringify({ ...user, token: 'legacy-jwt' }));
        const { default: reducer } = await freshSlice();
        const state = reducer(undefined, { type: '@@INIT' });
        expect(state.isAuthenticated).toBe(false);
        expect(localStorage.getItem('user')).toBeNull();
    });

    it('evicts an unparseable cache instead of crashing the boot', async () => {
        localStorage.setItem('user', '{not json');
        const { default: reducer } = await freshSlice();
        const state = reducer(undefined, { type: '@@INIT' });
        expect(state.isAuthenticated).toBe(false);
        expect(localStorage.getItem('user')).toBeNull();
    });

    it('ignores a cache without an _id', async () => {
        localStorage.setItem('user', JSON.stringify({ name: 'no id' }));
        const { default: reducer } = await freshSlice();
        expect(reducer(undefined, { type: '@@INIT' }).isAuthenticated).toBe(false);
    });
});

describe('authSlice actions', () => {
    beforeEach(() => localStorage.clear());

    it('loginSuccess stores the user and flips isAuthenticated', async () => {
        const { default: reducer, loginSuccess } = await freshSlice();
        const state = reducer(undefined, loginSuccess(user));
        expect(state).toEqual({ user, isAuthenticated: true });
        expect(JSON.parse(localStorage.getItem('user') as string)).toEqual(user);
    });

    it('logout clears state and storage', async () => {
        const { default: reducer, loginSuccess, logout } = await freshSlice();
        const signedIn = reducer(undefined, loginSuccess(user));
        const state = reducer(signedIn, logout());
        expect(state).toEqual({ user: null, isAuthenticated: false });
        expect(localStorage.getItem('user')).toBeNull();
    });
});
