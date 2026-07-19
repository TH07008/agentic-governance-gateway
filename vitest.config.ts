import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    extensions: [".ts", ".mts", ".js", ".mjs", ".json"],
    // Allow ESM `.js` specifiers (required by NodeNext) to resolve to `.ts`
    // source files when running tests through Vitest/Vite.
    extensionAlias: {
      ".js": [".ts", ".js"],
      ".mjs": [".mts", ".mjs"],
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      // Exclude files that are either pure re-export barrels (index.ts),
      // thin runtime entrypoints only meaningful when spawned (main.ts,
      // cli/index.ts), or type-only declarations.
      exclude: ["src/**/*.d.ts", "src/mcp/main.ts", "src/cli/index.ts", "src/index.ts"],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});