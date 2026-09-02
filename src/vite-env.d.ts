/// <reference types="vite/client" />

/**
 * The app version, replaced at build time with the one in package.json.
 * See the `define` block in vite.config.ts.
 */
declare const __APP_VERSION__: string;

/**
 * Whether this build was made with the updater configured. False in every
 * build until the signing keys exist; see the define in vite.config.ts.
 */
declare const __UPDATER_ENABLED__: boolean;
