import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Semantic search quality benchmark (downloads/uses the real model). See tests/quality.
export default defineConfig({
  resolve: { alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
  test: {
    include: ['tests/quality/**/*.quality.ts'],
    environment: 'node',
    testTimeout: 3_600_000
  }
})
