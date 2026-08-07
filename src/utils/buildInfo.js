// __APP_VERSION__/__APP_BUILD_TIME__ are injected by vite.config.js's
// `define` at build time -- typeof-guarded in case a build somehow skips
// that (e.g. a tool that evaluates this file outside a Vite build).
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const APP_BUILD_TIME = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : null;
