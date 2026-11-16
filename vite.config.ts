import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@supabase/")) return "auth-vendor";
          if (
            /\/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|use-sync-external-store|@remix-run)\//.test(
              id,
            )
          )
            return "ui-vendor";
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
    allowedHosts: ["localhost", "127.0.0.1"],
  },
  preview: {
    host: "127.0.0.1",
    port: 3000,
  },
});
