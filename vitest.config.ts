import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// In this repo we develop `markstream-terminal` as a workspace package.
// In CI or other clean checkouts, `packages/terminal/dist` may not exist
// (it's gitignored), so alias the package to its source entry for tests.
export default defineConfig({
  resolve: {
    alias: {
      'markstream-terminal': fileURLToPath(new URL('./packages/terminal/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
})
