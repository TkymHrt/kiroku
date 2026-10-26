import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  // Node tests use Vitest's server; Void owns the development/build environments.
  plugins: mode === "test" ? [] : [react(), voidPlugin()],
  server: { host: "127.0.0.1" },
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  lint: {
    plugins: ["typescript", "unicorn", "oxc", "react"],
    categories: { correctness: "error" },
    options: { typeAware: true, typeCheck: true },
  },
  fmt: {
    sortPackageJson: false,
    ignorePatterns: ["db/migrations/meta/**", "docs/*-backup-proof.json", "void.lock.json"],
  },
  run: {
    tasks: {
      "cached-build": {
        command: "vp build",
        cache: {
          // Void regenerates these from source, void.config.ts and void.lock.json.
          input: [{ auto: true }, "!.void/**", "!.void-wrangler.jsonc", "!.wrangler/**"],
          output: ["dist/**"],
        },
      },
    },
  },
}));
