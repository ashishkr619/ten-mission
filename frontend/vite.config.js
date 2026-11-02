import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// For `npm run dev` and `npm run preview`. Forwarding /api to the backend keeps the
// browser on one address, so no CORS setup is needed. Docker uses nginx instead.
const api = { "/api": process.env.API_URL ?? "http://127.0.0.1:4711" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 4710, proxy: api },
  preview: { port: 4710, proxy: api },
});
