import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["dotenv/config"],
    // The per-minute AI limits are off for the suite (many fast mock calls);
    // tests/ratelimit.test.ts checks the limiter with its own rules.
    env: { AI_RATE_PER_USER_MINUTE: "0", AI_RATE_PER_WORKSPACE_MINUTE: "0" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` / `client-only` are Next build markers that throw when
      // imported outside RSC; stub them so server modules are testable.
      "server-only": fileURLToPath(new URL("./tests/stubs/empty.ts", import.meta.url)),
      "client-only": fileURLToPath(new URL("./tests/stubs/empty.ts", import.meta.url)),
    },
  },
});
