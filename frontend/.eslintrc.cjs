/**
 * ESLint config for the SPA. `npm run lint` ran against nothing before this
 * file existed — ESLint 8 refuses to start without a config — so every
 * push shipped un-linted. This is the standard Vite + React + TS baseline
 * with one deliberate relaxation, noted inline.
 */
module.exports = {
    root: true,
    env: { browser: true, es2020: true },
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:react-hooks/recommended',
    ],
    ignorePatterns: ['dist', '.eslintrc.cjs'],
    parser: '@typescript-eslint/parser',
    plugins: ['react-refresh'],
    rules: {
        'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
        // Underscore-prefixed names are the conventional "deliberately
        // unused" marker (e.g. destructuring a prop out of a rest spread).
        '@typescript-eslint/no-unused-vars': ['error', {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            destructuredArrayIgnorePattern: '^_',
            ignoreRestSiblings: true,
        }],
        // API payloads (companies, events, compliance rows) are typed `any`
        // throughout the components. Turning this on today would mean
        // several hundred edits with no behaviour change — tighten it once
        // the payload types are shared with the backend.
        '@typescript-eslint/no-explicit-any': 'off',
    },
};
