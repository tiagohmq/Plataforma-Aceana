import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    // Cada arquivo abre o Postgres embutido (WASM pesado): muitos em paralelo estouram tempo na máquina do time.
    maxWorkers: 3,
  },
});
