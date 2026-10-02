import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Project Pages URL is https://aiontrust.github.io/macro-tracker/
// Dev server stays at /. Override with VITE_BASE if the repo name changes.
const pagesBase = process.env.VITE_BASE || "/macro-tracker/";

export default defineConfig(({ command }) => ({
  base: command === "serve" ? "/" : pagesBase,
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/*.png"],
      manifest: {
        name: "ONE SET.",
        short_name: "ONE SET.",
        description:
          "One entry a day. Protein, carbs, fat, and calories, stored only on this device.",
        theme_color: "#0B0B0C",
        background_color: "#0B0B0C",
        display: "standalone",
        orientation: "portrait",
        start_url: "./",
        scope: "./",
        id: "./",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,woff}"],
        navigateFallback: "index.html",
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
