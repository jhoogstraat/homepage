import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import node from "@astrojs/node";

export default defineConfig({
  site: "https://hoogstraat.net",
  output: "static",
  compressHTML: true,
  vite: { plugins: [tailwindcss()] },
  integrations: [sitemap()],
  adapter: node({ mode: "standalone" }),
  redirects: { "/blog": "/about" },
});
