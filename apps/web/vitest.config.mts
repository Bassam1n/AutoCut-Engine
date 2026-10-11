import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // "server-only" is a Next.js build-time guard with no runtime
      // export — it only resolves inside Next's own bundler. Vitest
      // runs provider/adapter code outside that pipeline, so alias it
      // to a real empty module rather than stripping the import from
      // source files that are also used by the Next.js build.
      "server-only": path.resolve(import.meta.dirname, "./src/lib/test-support/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
