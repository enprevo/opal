import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        // The semantic index runs in its own utility process (see src/main/semantic/worker.ts).
        input: { index: resolve(__dirname, 'src/main/index.ts'), semanticWorker: resolve(__dirname, 'src/main/semantic/worker.ts') }
      }
    }
  },
  preload: {
    build: { outDir: 'out/preload' }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
    plugins: [react()],
    build: { outDir: 'out/renderer' }
  }
})
