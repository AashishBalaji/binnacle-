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
      include: ['src/alarms/**', 'src/components/**', 'src/handoff/**', 'src/recommendations/**', 'server/**'],
      // Thresholds set just below the actual numbers measured when
      // they were last updated (typically 94.5/90.1/93.0/95.5 after
      // stage 3's recommendations module was added -- previously
      // 91.4/90.6/87.5/92.6 at stage 2), not an aspirational round
      // number: this is a real floor meant to catch a regression,
      // same as scripts/check-bundle-budget.mjs is a real floor on
      // bundle size rather than a number someone will eventually
      // hit. Margin below the typical measurement (rather than
      // pinned right at it) is deliberate: handoffMachine's branch
      // coverage comes from fast-check's property tests, which run
      // genuinely random sequences each time, so the measured number
      // has a small amount of real run-to-run variance (observed
      // 94.26-94.51 statements, 92.18-92.96 functions across several
      // local runs) -- a threshold pinned at the top of that range
      // would make CI flaky on an unlucky seed rather than catch an
      // actual regression.
      thresholds: {
        statements: 93,
        branches: 88,
        functions: 91,
        lines: 94,
      },
    },
  },
})
