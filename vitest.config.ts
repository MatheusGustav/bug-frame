import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', include: ['test/widget/**/*.test.ts'], setupFiles: ['test/widget/setup.ts'], restoreMocks: true, maxWorkers: 2 } });
