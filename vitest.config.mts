import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/web/**/*.test.{ts,tsx}"],
    alias: {
      "@": fileURLToPath(new URL("./apps/web", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/unit/server-only.ts", import.meta.url),
      ),
    },
  },
});
