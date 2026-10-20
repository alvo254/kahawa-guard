import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the gateway so the browser only ever talks to one
// address, same as nginx.conf does in the built image.
//
// The gateway must be reachable at GATEWAY_URL from wherever `npm run dev` runs.
// Default is localhost:8000 (a `make forward` / `kubectl port-forward` on the
// same machine). If the cluster lives on another host, point this at it, e.g.:
//   GATEWAY_URL=http://containerlab.local:30080 npm run dev     (NodePort), or
//   GATEWAY_URL=http://127.0.0.1:8000 npm run dev  after: ssh -L 8000:localhost:8000 <host>
const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:8000";

// A short build stamp (date + minute), shown in the UI so you can tell at a
// glance whether you are on a fresh build or a stale cached/in-cluster one.
const BUILD_ID = new Date().toISOString().slice(0, 16).replace("T", " ");

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: GATEWAY_URL,
        changeOrigin: true,
        // the gateway's /api/events is SSE; do not buffer the proxied response
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => proxyReq.setHeader("accept-encoding", "identity"));
        },
      },
    },
  },
});
