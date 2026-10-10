import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Built to ./dist, which `gut run --inspect` serves; nothing is fetched from elsewhere at runtime.
// In dev, /api goes to a running `gut run --inspect --port 4321 --no-open` (GUT_INSPECT_PORT to
// change it): open the dev page with the token the CLI printed, `?token=…`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.GUT_INSPECT_PORT ?? '4321'}`,
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
