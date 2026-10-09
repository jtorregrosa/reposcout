import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = { '@': fileURLToPath(new URL('./web/src', import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          include: ['test/**/*.test.ts', 'web/src/**/*.test.ts'],
          environment: 'node',
          // The database tests run beside the jsdom project; on a CI runner the shared CPU slows them past 5s.
          testTimeout: 15_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'web',
          include: ['web/src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['web/src/test/setup.ts'],
          // Whole pages render in jsdom; the first test of a file also loads its lazy chunk.
          testTimeout: 20_000,
        },
      },
    ],
  },
});
