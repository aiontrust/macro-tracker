import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Cloudflare Pages serves the app at the domain root. Dev, preview, and
// production all use `/`, including demo mode at `/?demo=1`.
const root = "/";

export default defineConfig({
  base: root,
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      scope: root,
      // Icons are copied into dist and precached by the glob below.
      includeManifestIcons: false,
      manifest: {
        name: "ONE SET.",
        short_name: "ONE SET.",
        description:
          "One entry a day. Protein, carbs, fat, and calories, stored only on this device.",
        theme_color: "#0B0B0C",
        background_color: "#0B0B0C",
        display: "standalone",
        orientation: "portrait",
        start_url: root,
        scope: root,
        id: root,
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,woff}"],
        navigateFallback: "/index.html",
        // Precache URLs are root paths (`/assets/...`), not a project subpath.
        manifestTransforms: [
          (entries) => ({
            manifest: entries.map((entry) => ({
              ...entry,
              url: entry.url.startsWith("/") ? entry.url : `${root}${entry.url}`,
            })),
          }),
        ],
      },
      integration: {
        beforeBuildServiceWorker(options) {
          const entries = options.workbox.additionalManifestEntries ?? [];
          for (const entry of entries) {
            if (typeof entry !== "string" && !entry.url.startsWith("/")) entry.url = `${root}${entry.url}`;
          }
        },
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
