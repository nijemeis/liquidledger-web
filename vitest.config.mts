import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      // Integration tests use their own database (created and migrated by tests/setup-db.ts).
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://liquidledger:liquidledger@localhost:5432/liquidledger_test",
      DIRECT_URL: process.env.TEST_DATABASE_URL ?? "postgresql://liquidledger:liquidledger@localhost:5432/liquidledger_test",
      APP_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    },
    globalSetup: ["tests/setup-db.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
});
