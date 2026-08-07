import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Cloudflare Pages sets CF_PAGES_COMMIT_SHA at build time; local dev has no
// such env var, so fall back to asking git directly. Either way this lets
// My profile show which deploy is actually running -- otherwise there's no
// way to tell an installed PWA is serving a stale cached build versus the
// latest push.
function getCommitHash() {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(getCommitHash()),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
