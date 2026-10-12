import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Built to ./dist, which `gut run --inspect` serves; nothing is fetched from elsewhere at runtime.
// In dev, /api goes to a running `gut run --inspect --port 4321 --no-open` (GUT_INSPECT_PORT to
// change it): open the dev page with the token the CLI printed, `?token=…`.
// `--mode replay` builds the replay of a recorded run instead (src/lib/connection.ts), with
// relative URLs so a site can serve it from any directory.
export default defineConfig(({ mode }) => {
  const isReplay = mode === 'replay';
  return {
    plugins: [react(), tailwindcss()],
    base: isReplay ? './' : '/',
    server: {
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${process.env.GUT_INSPECT_PORT ?? '4321'}`,
          changeOrigin: true,
        },
      },
    },
    build: { outDir: isReplay ? 'dist-replay' : 'dist', sourcemap: false },
  };
});
