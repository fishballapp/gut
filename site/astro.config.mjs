// @ts-check

import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://gut.run',
  trailingSlash: 'never',
  build: { format: 'file' },
  // /og is the page public/og.png is screenshotted from, not a page to find.
  integrations: [sitemap({ filter: page => !page.endsWith('/og') })],
  vite: {
    plugins: [tailwindcss()],
  },
});
