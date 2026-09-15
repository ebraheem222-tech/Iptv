import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const apiTarget = process.env.NOVA_PROXY_TARGET || "http://127.0.0.1:3000";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": apiTarget,
      "/media": apiTarget,
      "/image": apiTarget,
      "/artwork": apiTarget,
    },
  },
});
