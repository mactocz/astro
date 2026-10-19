import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Mirrors compatibility_date and compatibility_flags in wrangler.jsonc; change them together.
      // Not pointed at wrangler.jsonc on purpose: its `main` is the Astro adapter entry and `assets` needs dist/.
      miniflare: { compatibilityDate: "2026-05-08", compatibilityFlags: ["nodejs_compat"] },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
