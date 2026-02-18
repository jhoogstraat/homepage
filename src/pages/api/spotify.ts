import type { APIRoute } from "astro";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

type SpotifyTrack = {
  name?: string;
  artists?: { name?: string }[];
  external_urls?: { spotify?: string };
  album?: { images?: { url?: string }[] };
};

type NowPlayingPayload = {
  source: "spotify" | "unconfigured" | "error";
  isPlaying: boolean;
  title: string | null;
  artist: string | null;
  songUrl: string | null;
  albumImageUrl: string | null;
  playedAt: string | null;
  message?: string;
};

type TokenStorePayload = {
  refreshToken: string;
  updatedAt: string;
};

type RefreshTokenResponse = {
  accessToken: string;
  rotatedRefreshToken: string | null;
};

type EndpointResult = {
  status: number;
  payload: NowPlayingPayload;
};

type CachedResponse = EndpointResult & {
  expiresAt: number;
};

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const CURRENTLY_PLAYING_ENDPOINT = "https://api.spotify.com/v1/me/player/currently-playing";
const RECENTLY_PLAYED_ENDPOINT = "https://api.spotify.com/v1/me/player/recently-played?limit=1";

const SPOTIFY_CLIENT_ID = import.meta.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = import.meta.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REFRESH_TOKEN = import.meta.env.SPOTIFY_REFRESH_TOKEN;
const SPOTIFY_TOKEN_STORE_PATH = import.meta.env.SPOTIFY_TOKEN_STORE_PATH || ".spotify/refresh-token.json";
const SPOTIFY_RESPONSE_CACHE_TTL_MS = Number.parseInt(import.meta.env.SPOTIFY_RESPONSE_CACHE_TTL_MS || "300000", 10);
const SPOTIFY_RESPONSE_ERROR_CACHE_TTL_MS = Number.parseInt(import.meta.env.SPOTIFY_RESPONSE_ERROR_CACHE_TTL_MS || "5000", 10);
const SPOTIFY_UNCONFIGURED_CACHE_TTL_MS = Number.parseInt(import.meta.env.SPOTIFY_UNCONFIGURED_CACHE_TTL_MS || "60000", 10);

let cachedResponse: CachedResponse | null = null;
let inFlightResponse: Promise<EndpointResult> | null = null;

function json(payload: NowPlayingPayload, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function parseTrack(track: SpotifyTrack | null | undefined) {
  if (!track) {
    return {
      title: null,
      artist: null,
      songUrl: null,
      albumImageUrl: null,
    };
  }

  const title = typeof track.name === "string" && track.name.trim() ? track.name.trim() : null;

  const artistNames = Array.isArray(track.artists)
    ? track.artists
        .map((artist) => (typeof artist?.name === "string" ? artist.name.trim() : ""))
        .filter(Boolean)
    : [];

  const artist = artistNames.length > 0 ? artistNames.join(", ") : null;
  const songUrl = typeof track.external_urls?.spotify === "string" ? track.external_urls.spotify : null;
  const albumImageUrl =
    Array.isArray(track.album?.images) && typeof track.album.images[0]?.url === "string"
      ? track.album.images[0].url
      : null;

  return {
    title,
    artist,
    songUrl,
    albumImageUrl,
  };
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function tokenStorePath(): string {
  return isAbsolute(SPOTIFY_TOKEN_STORE_PATH) ? SPOTIFY_TOKEN_STORE_PATH : resolve(process.cwd(), SPOTIFY_TOKEN_STORE_PATH);
}

async function readStoredRefreshToken(): Promise<string | null> {
  try {
    const raw = await readFile(tokenStorePath(), "utf-8");
    const data = JSON.parse(raw) as Partial<TokenStorePayload>;
    return normalizeToken(data.refreshToken);
  } catch {
    return null;
  }
}

async function persistRefreshToken(refreshToken: string): Promise<void> {
  const normalized = normalizeToken(refreshToken);
  if (!normalized) return;

  const path = tokenStorePath();
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });

  const payload: TokenStorePayload = {
    refreshToken: normalized,
    updatedAt: new Date().toISOString(),
  };

  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  await rename(tempPath, path);
}

async function requestAccessToken(refreshToken: string): Promise<RefreshTokenResponse> {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error("Missing Spotify client credentials");
  }

  const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      errorText
        ? `Spotify token request failed with status ${response.status}: ${errorText}`
        : `Spotify token request failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as { access_token?: unknown; refresh_token?: unknown };
  const accessToken = normalizeToken(data.access_token);

  if (!accessToken) {
    throw new Error("Spotify token response did not include access_token");
  }

  return {
    accessToken,
    rotatedRefreshToken: normalizeToken(data.refresh_token),
  };
}

function tokenCandidates(storedRefreshToken: string | null, envRefreshToken: string | null): string[] {
  const candidates: string[] = [];
  if (storedRefreshToken) candidates.push(storedRefreshToken);
  if (envRefreshToken && envRefreshToken !== storedRefreshToken) candidates.push(envRefreshToken);
  return candidates;
}

async function resolveSpotifySession(): Promise<{ accessToken: string }> {
  const storedRefreshToken = await readStoredRefreshToken();
  const envRefreshToken = normalizeToken(SPOTIFY_REFRESH_TOKEN);
  const candidates = tokenCandidates(storedRefreshToken, envRefreshToken);

  if (candidates.length === 0) {
    throw new Error("Missing Spotify refresh token");
  }

  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const tokenResult = await requestAccessToken(candidate);
      const latestRefreshToken = tokenResult.rotatedRefreshToken || candidate;

      if (latestRefreshToken !== storedRefreshToken) {
        try {
          await persistRefreshToken(latestRefreshToken);
        } catch (error) {
          console.error("Failed to persist rotated Spotify refresh token:", error);
        }
      }

      return { accessToken: tokenResult.accessToken };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to refresh Spotify access token");
}

async function fetchFromSpotify(url: string, accessToken: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
}

function effectiveTtl(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function cacheTtlFor(result: EndpointResult): number {
  if (result.payload.source === "error") {
    return effectiveTtl(SPOTIFY_RESPONSE_ERROR_CACHE_TTL_MS, 5000);
  }
  if (result.payload.source === "unconfigured") {
    return effectiveTtl(SPOTIFY_UNCONFIGURED_CACHE_TTL_MS, 60000);
  }
  return effectiveTtl(SPOTIFY_RESPONSE_CACHE_TTL_MS, 300000);
}

function buildCachedResult(result: EndpointResult): CachedResponse {
  return {
    ...result,
    expiresAt: Date.now() + cacheTtlFor(result),
  };
}

function readFreshCache(): EndpointResult | null {
  if (!cachedResponse) return null;
  if (Date.now() >= cachedResponse.expiresAt) return null;
  return {
    status: cachedResponse.status,
    payload: cachedResponse.payload,
  };
}

async function fetchLiveResult(): Promise<EndpointResult> {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    return {
      status: 200,
      payload: {
        source: "unconfigured",
        isPlaying: false,
        title: null,
        artist: null,
        songUrl: null,
        albumImageUrl: null,
        playedAt: null,
        message: "Spotify client credentials are not configured on the server.",
      },
    };
  }

  try {
    const { accessToken } = await resolveSpotifySession();

    const nowPlayingResponse = await fetchFromSpotify(CURRENTLY_PLAYING_ENDPOINT, accessToken);

    if (nowPlayingResponse.status === 200) {
      const data = (await nowPlayingResponse.json()) as { is_playing?: boolean; item?: SpotifyTrack | null };
      const track = parseTrack(data.item);

      if (track.title || track.artist) {
        return {
          status: 200,
          payload: {
            source: "spotify",
            isPlaying: Boolean(data.is_playing),
            ...track,
            playedAt: null,
          },
        };
      }
    } else if (nowPlayingResponse.status !== 204) {
      throw new Error(`Spotify currently-playing request failed with status ${nowPlayingResponse.status}`);
    }

    const recentlyPlayedResponse = await fetchFromSpotify(RECENTLY_PLAYED_ENDPOINT, accessToken);

    if (recentlyPlayedResponse.status === 200) {
      const data = (await recentlyPlayedResponse.json()) as {
        items?: { track?: SpotifyTrack | null; played_at?: string }[];
      };
      const item = Array.isArray(data.items) ? data.items[0] : undefined;
      const track = parseTrack(item?.track);

      return {
        status: 200,
        payload: {
          source: "spotify",
          isPlaying: false,
          ...track,
          playedAt: typeof item?.played_at === "string" ? item.played_at : null,
        },
      };
    }

    if (recentlyPlayedResponse.status !== 204) {
      throw new Error(`Spotify recently-played request failed with status ${recentlyPlayedResponse.status}`);
    }

    return {
      status: 200,
      payload: {
        source: "spotify",
        isPlaying: false,
        title: null,
        artist: null,
        songUrl: null,
        albumImageUrl: null,
        playedAt: null,
      },
    };
  } catch {
    return {
      status: 502,
      payload: {
        source: "error",
        isPlaying: false,
        title: null,
        artist: null,
        songUrl: null,
        albumImageUrl: null,
        playedAt: null,
        message: "Unable to reach Spotify API.",
      },
    };
  }
}

async function getCachedOrFreshResult(): Promise<EndpointResult> {
  const fromCache = readFreshCache();
  if (fromCache) return fromCache;

  if (inFlightResponse) return inFlightResponse;

  inFlightResponse = (async () => {
    const result = await fetchLiveResult();
    cachedResponse = buildCachedResult(result);
    return result;
  })();

  try {
    return await inFlightResponse;
  } finally {
    inFlightResponse = null;
  }
}

export const GET: APIRoute = async () => {
  const result = await getCachedOrFreshResult();
  return json(result.payload, result.status);
};
