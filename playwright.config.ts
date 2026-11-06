import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 20_000,
  use: {
    baseURL: "http://localhost:1420",
    ...devices["Desktop Chrome"],
    // Matches the real logical size of the floating window.
    viewport: { width: 300, height: 50 },
  },
  // Three projects, because these specs do different jobs. `docs` writes the
  // README images into a tracked folder, so running it as part of an ordinary
  // test run turns every run into a diff nobody asked for. `walkthrough`
  // photographs every step of every control into an untracked folder, to be
  // looked at after a change rather than on every run.
  projects: [
    { name: "suite", testIgnore: ["docs-shots.spec.ts", "walkthrough.spec.ts"] },
    { name: "docs", testMatch: "docs-shots.spec.ts" },
    { name: "walkthrough", testMatch: "walkthrough.spec.ts" },
  ],
  webServer: {
    command: "npx vite --port 1420 --strictPort",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
