import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    // En desarrollo el agente corre aparte (`npm run dev`). El proxy evita
    // CORS y reproduce la topología de producción, donde Caddy sirve la UI y
    // el agente en el mismo origen.
    proxy: {
      "/eve": { target: "http://127.0.0.1:2000", changeOrigin: true },
      "/.well-known/workflow": { target: "http://127.0.0.1:2000", changeOrigin: true },
    },
  },
});
