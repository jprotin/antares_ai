import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = fileURLToPath(new URL("./src", import.meta.url));
// Pile antares (nginx) vers laquelle le serveur de dev relaie les appels
const target = process.env.ANTARES_URL ?? "http://127.0.0.1:8765";
// nginx et le routeur n'admettent que l'origine de l'interface servie par nginx
// (nginx.conf.template, router/write_guard.py) : celle du serveur de dev, et elle seule,
// est remplacée ; toute autre Origin est relayée telle quelle (donc refusée)
const DEV_ORIGINS = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);
type OutgoingRequest = {
  getHeader(name: string): unknown;
  setHeader(name: string, value: string): unknown;
};
function devOrigin(request: OutgoingRequest) {
  const origin = request.getHeader("origin");
  if (typeof origin === "string" && DEV_ORIGINS.has(origin))
    request.setHeader("origin", new URL(target).origin);
}

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: src },
      // react-remove-scroll-bar injecte un <style> (bloqué par la CSP) : remplacé par un
      // shim aux règles statiques ; couvre aussi l'import de react-remove-scroll-bar/constants
      {
        find: /^react-remove-scroll-bar(\/constants)?$/,
        replacement: `${src}/shims/remove-scroll-bar$1`,
      },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/v1": {
        target,
        ws: true,
        configure: (proxy) => {
          proxy.on("proxyReq", devOrigin);
          proxy.on("proxyReqWs", devOrigin);
        },
      },
      "/api": {
        target,
        configure: (proxy) => proxy.on("proxyReq", devOrigin),
      },
      "/voices": { target },
      "/config.json": { target },
    },
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    sourcemap: false,
    modulePreload: { polyfill: false },
    // three.js (660 Ko) et l'application (highlight.js compris) dépassent 500 Ko
    chunkSizeWarningLimit: 700,
    // three.js dans son propre fichier (chargé au démarrage, comme avant : parité)
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: "three", test: /node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
});
