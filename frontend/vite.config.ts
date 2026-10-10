import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies the API to the backend; the production build is served by FastAPI.
const backend = process.env.GUIDEWING_BACKEND ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": backend,
      "/ws": { target: backend.replace(/^http/, "ws"), ws: true },
    },
  },
});
