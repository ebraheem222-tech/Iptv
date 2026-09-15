import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: [
    {
      command: "node server/index.js",
      url: "http://127.0.0.1:3100/api/health",
      env: { ...process.env, PORT: "3100" },
      reuseExistingServer: false,
    },
    {
      command: "npx vite --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      env: {
        ...process.env,
        NOVA_PROXY_TARGET: "http://127.0.0.1:3100",
      },
      reuseExistingServer: false,
    },
  ],
});
