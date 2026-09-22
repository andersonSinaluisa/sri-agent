import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A dónde apunta el proxy de desarrollo.
//   - por defecto: el agente local (`npm run dev`)
//   - con un túnel SSH abierto contra el VPS: EVE_TARGET=http://127.0.0.1:3000
const destino = process.env.EVE_TARGET ?? "http://127.0.0.1:2000";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    // El proxy evita CORS y reproduce la topología de producción, donde Caddy
    // sirve la UI y el agente en el mismo origen.
    proxy: {
      "/eve": { target: destino, changeOrigin: true },
      "/.well-known/workflow": { target: destino, changeOrigin: true },
    },
  },
});
