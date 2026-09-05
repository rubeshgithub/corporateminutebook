const { join } = require('path');

/**
 * Keep Puppeteer's Chrome download inside the project directory.
 *
 * Puppeteer's default cache is ~/.cache/puppeteer. On Render that path is
 * outside the deployed project tree, so `npx puppeteer browsers install
 * chrome` succeeds during the build and the running service still reports
 * "Could not find Chrome" on the first PDF — every generate / compile call
 * then fails with a generic 500. Pinning the cache to backend/.cache makes
 * the build-time download part of what gets deployed.
 *
 * Both the install command and the runtime read this file (it is resolved
 * from the working directory, which is backend/ in every environment).
 * PUPPETEER_EXECUTABLE_PATH, when set (local dev), still takes precedence.
 * backend/.cache is gitignored.
 */
module.exports = {
    cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
