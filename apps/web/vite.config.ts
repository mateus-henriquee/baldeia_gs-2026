import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const root = path.resolve(__dirname, "../..");
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@data": path.join(root, "data") } },
  server: {
    port: 5173,
    fs: { allow: [root] },
    proxy: { "/api": { target: `http://localhost:${process.env.API_PORT ?? 3333}`, changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 900 },
});
