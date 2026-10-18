import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the gateway so the browser only ever talks to one
// address, same as nginx.conf does in the built image.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
});
