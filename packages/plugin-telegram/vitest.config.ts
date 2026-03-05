import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@personal-ai\/plugin-assistant\/(.+)$/,
        replacement: resolve(__dirname, "../plugin-assistant/src/$1.ts"),
      },
      {
        find: /^@personal-ai\/([^/]+)$/,
        replacement: resolve(__dirname, "../$1/src/index.ts"),
      },
    ],
  },
});
