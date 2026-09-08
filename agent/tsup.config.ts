import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'agent/src/cli.ts',
    index: 'agent/index.ts',
  },
  outDir: 'dist-agent',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,
  shims: true,
  publicDir: 'agent/static',
});
