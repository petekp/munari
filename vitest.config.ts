import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    allowOnly: false,
    expect: { requireAssertions: true },
    include: [
      'tests/**/*.test.{ts,tsx}',
      'packages/*/src/**/*.test.{ts,tsx}',
      'apps/*/src/**/*.test.{ts,tsx}',
      'instruments/**/*.test.{ts,tsx}',
    ],
  },
})
