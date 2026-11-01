/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/alarms/**', 'src/components/**', 'server/**'],
      // Thresholds set just below the actual numbers at the time
      // they were added (91.4/90.6/87.5/92.6 -- see the commit that
      // introduced this), not an aspirational round number: this is
      // a real floor meant to catch a regression, same as
      // scripts/check-bundle-budget.mjs is a real floor on bundle
      // size rather than a number someone will eventually hit.
      thresholds: {
        statements: 88,
        branches: 85,
        functions: 82,
        lines: 88,
      },
    },
  },
})
