import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'verify-arch-unit',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
