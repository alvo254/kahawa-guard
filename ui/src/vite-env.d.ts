/// <reference types="vite/client" />

// Injected by vite.config.ts at build time, so a visible stamp confirms which
// build is actually being served (stale in-cluster image vs fresh dev).
declare const __BUILD_ID__: string;
