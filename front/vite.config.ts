/// <reference types="vitest/config" />
// Front v2 (React + Vite), servi sous /myservices/v2/.
//
// Développement (npm run dev, comme MynetworK) : Vite sert le front avec rechargement à chaud sur :5180 et
// relaie tout le reste de /myservices/ (API, data.json, page de connexion…) vers le conteneur de test
// (MYSERVICES_BACKEND, défaut http://127.0.0.1:8090). L'en-tête Host est gardé (changeOrigin: false) :
// le contrôle d'origine des écritures et le cookie de session marchent comme en production.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BACKEND = process.env.MYSERVICES_BACKEND || "http://127.0.0.1:8090";
const PORT = parseInt(process.env.VITE_PORT || "5180", 10);

export default defineConfig({
  base: "/myservices/v2/",
  plugins: [react()],
  server: {
    port: PORT,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: ["localhost", ...(process.env.MS_DEV_HOSTS ?? "").split(",").filter(Boolean)], // ex. MS_DEV_HOSTS=192.168.1.20
    headers: { "Cache-Control": "no-store" },
    proxy: {
      // Tout /myservices/ sauf le front lui-même (/myservices/v2/)
      "^/myservices/(?!v2/).*": {
        target: BACKEND,
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on("error", (_err, _req, res) => {
            if ("writeHead" in res && !res.headersSent) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: `conteneur injoignable (${BACKEND}) : docker compose up -d` }));
            }
          });
        },
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  test: { environment: "node" },
});
