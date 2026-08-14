import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: { target: "esnext" },
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: !!process.env.PORT,
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Trashlands",
        short_name: "Trashlands",
        description: "You are dirt. Roll. Collect. Grow.",
        theme_color: "#2f2418",
        background_color: "#1C160F",
        display: "standalone",
        orientation: "any",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /\/audio\/.*\.mp3$/,
            handler: "CacheFirst",
            options: {
              cacheName: "trashlands-audio",
              expiration: { maxEntries: 8 },
              rangeRequests: true,
              cacheableResponse: { statuses: [0, 200, 206] },
            },
          },
        ],
      },
    }),
  ],
});
