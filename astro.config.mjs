// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import sitemap from '@astrojs/sitemap';

import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  site: "https://example.com/",
  output: "server",

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [sitemap()],

  adapter: node({
    mode: 'standalone'
  })
});
