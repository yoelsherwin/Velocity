import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000, // 60s per test — app startup + dev server is slow
  retries: 1, // Retry once on failure (flakiness buffer for app startup)
  workers: 1, // Serial execution — all tests share the same CDP port
  use: {
    // No browser launch config — we connect via CDP in the fixture
  },
  // Single project for Tauri WebView2 testing
  projects: [
    {
      name: "tauri",
      use: {},
    },
  ],
});
