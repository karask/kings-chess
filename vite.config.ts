import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { port: 3000, strictPort: false },
  preview: { port: 4173, strictPort: false },
  build: { target: "es2020", sourcemap: true, chunkSizeWarningLimit: 650 },
  worker: { format: "es" },
});
