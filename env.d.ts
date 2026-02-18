/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly BESZEL_BASE_URL?: string;
  readonly SPOTIFY_CLIENT_ID?: string;
  readonly SPOTIFY_CLIENT_SECRET?: string;
  readonly SPOTIFY_REFRESH_TOKEN?: string;
  readonly SPOTIFY_TOKEN_STORE_PATH?: string;
  readonly SPOTIFY_RESPONSE_CACHE_TTL_MS?: string;
  readonly SPOTIFY_RESPONSE_ERROR_CACHE_TTL_MS?: string;
  readonly SPOTIFY_UNCONFIGURED_CACHE_TTL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.astro' {
  import type { AstroComponentFactory } from 'astro';
  const component: AstroComponentFactory;
  export default component;
}
