import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = fileURLToPath(new URL("./src", import.meta.url));
// Pile antares (nginx) vers laquelle le serveur de dev relaie les appels
const target = process.env.ANTARES_URL ?? "http://127.0.0.1:8765";

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
      "/v1": { target, ws: true },
      "/api": { target },
      "/voices": { target },
      "/config.json": { target },
    },
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
});
