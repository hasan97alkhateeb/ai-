import path from 'node:path';
import { defineConfig, mergeConfig } from 'vite';
import appConfig from './vite.config';

export default mergeConfig(
  appConfig,
  defineConfig({
    resolve: {
      alias: [
        {
          find: /^@clerk\/react$/,
          replacement: path.resolve(
            import.meta.dirname,
            'src/test-support/practice-e2e-clerk.ts',
          ),
        },
      ],
    },
    server: {
      host: '127.0.0.1',
      allowedHosts: true,
    },
  }),
);