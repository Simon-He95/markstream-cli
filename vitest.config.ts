import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// In this repo we develop `markstream-terminal` as a workspace package, but in
// some environments (e.g. Node < 18 where pnpm can't run) it may not be linked
// into `node_modules`. Alias it for tests so `src/*` can still import it.
export default defineConfig({
  resolve: {
    alias: {
      'markstream-terminal': fileURLToPath(new URL('./packages/terminal/dist/index.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
})
