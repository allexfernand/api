import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "server-only": new URL("./tests/server-only.ts", import.meta.url).pathname } },
  test: {
    environment: "node",
    coverage: { reporter: ["text", "html"] },
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
  },
});
