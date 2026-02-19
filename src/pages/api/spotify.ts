import type { APIRoute } from "astro";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export const prerender = false;

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

type TokenCandidate = {
  source: "stored" | "env";
  value: string;
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
const SPOTIFY_LOG_PREFIX = "[api/spotify]";
const RESPONSE_SNIPPET_MAX_LENGTH = 400;

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

function makeRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function logWithLevel(level: "info" | "warn" | "error", requestId: string, message: string, details?: unknown): void {
  const prefix = `${SPOTIFY_LOG_PREFIX} [${requestId}] ${message}`;
  if (details === undefined) {
    console[level](prefix);
    return;
  }
  console[level](prefix, details);
}

function formatError(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || "",
    };
  }
  return { message: String(error) };
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code === code
  );
}

async function readResponseSnippet(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().text()).trim();
    if (!body) return null;
    if (body.length <= RESPONSE_SNIPPET_MAX_LENGTH) return body;
    return `${body.slice(0, RESPONSE_SNIPPET_MAX_LENGTH)}...`;
  } catch {
    return null;
  }
}

function tokenStorePath(): string {
  return isAbsolute(SPOTIFY_TOKEN_STORE_PATH) ? SPOTIFY_TOKEN_STORE_PATH : resolve(process.cwd(), SPOTIFY_TOKEN_STORE_PATH);
}

async function readStoredRefreshToken(requestId: string): Promise<string | null> {
  try {
    const raw = await readFile(tokenStorePath(), "utf-8");
    const data = JSON.parse(raw) as Partial<TokenStorePayload>;
    const token = normalizeToken(data.refreshToken);
    logWithLevel("info", requestId, "Loaded refresh token from token store", {
      tokenStorePath: tokenStorePath(),
      hasRefreshToken: Boolean(token),
    });
    return token;
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      logWithLevel("info", requestId, "Token store file not found; using env token if available", {
        tokenStorePath: tokenStorePath(),
      });
      return null;
    }
    logWithLevel("warn", requestId, "Failed to read token store; using env token if available", formatError(error));
    return null;
  }
}

async function persistRefreshToken(refreshToken: string, requestId: string): Promise<void> {
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
  logWithLevel("info", requestId, "Persisted refresh token to token store", { tokenStorePath: path });
}

async function requestAccessToken(refreshToken: string, requestId: string): Promise<RefreshTokenResponse> {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error("Missing Spotify client credentials");
  }

  logWithLevel("info", requestId, "Requesting access token from Spotify");

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
    logWithLevel("warn", requestId, "Spotify token request failed", {
      status: response.status,
      responseBody: errorText || null,
    });
    throw new Error(
      errorText
        ? `Spotify token request failed with status ${response.status}: ${errorText}`
        : `Spotify token request failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as { access_token?: unknown; refresh_token?: unknown };
  const accessToken = normalizeToken(data.access_token);

  if (!accessToken) {
    logWithLevel("warn", requestId, "Spotify token response missing access_token");
    throw new Error("Spotify token response did not include access_token");
  }

  logWithLevel("info", requestId, "Spotify token request succeeded", {
    hasRotatedRefreshToken: Boolean(normalizeToken(data.refresh_token)),
  });

  return {
    accessToken,
    rotatedRefreshToken: normalizeToken(data.refresh_token),
  };
}

function tokenCandidates(storedRefreshToken: string | null, envRefreshToken: string | null): TokenCandidate[] {
  const candidates: TokenCandidate[] = [];
  if (storedRefreshToken) candidates.push({ source: "stored", value: storedRefreshToken });
  if (envRefreshToken && envRefreshToken !== storedRefreshToken) {
    candidates.push({ source: "env", value: envRefreshToken });
  }
  return candidates;
}

async function resolveSpotifySession(requestId: string): Promise<{ accessToken: string }> {
  const storedRefreshToken = await readStoredRefreshToken(requestId);
  const envRefreshToken = normalizeToken(SPOTIFY_REFRESH_TOKEN);
  const candidates = tokenCandidates(storedRefreshToken, envRefreshToken);
  logWithLevel("info", requestId, "Resolved refresh token candidates", {
    hasStoredRefreshToken: Boolean(storedRefreshToken),
    hasEnvRefreshToken: Boolean(envRefreshToken),
    candidateCount: candidates.length,
  });

  if (candidates.length === 0) {
    throw new Error("Missing Spotify refresh token");
  }

  let lastError: unknown = null;

  for (const [index, candidate] of candidates.entries()) {
    logWithLevel("info", requestId, "Trying refresh token candidate", {
      candidate: `${index + 1}/${candidates.length}`,
      source: candidate.source,
    });
    try {
      const tokenResult = await requestAccessToken(candidate.value, requestId);
      const latestRefreshToken = tokenResult.rotatedRefreshToken || candidate.value;
      logWithLevel("info", requestId, "Refresh token candidate succeeded", {
        source: candidate.source,
        hasRotatedRefreshToken: Boolean(tokenResult.rotatedRefreshToken),
      });

      if (latestRefreshToken !== storedRefreshToken) {
        try {
          await persistRefreshToken(latestRefreshToken, requestId);
        } catch (error) {
          logWithLevel("error", requestId, "Failed to persist rotated Spotify refresh token", formatError(error));
        }
      }

      return { accessToken: tokenResult.accessToken };
    } catch (error) {
      logWithLevel("warn", requestId, "Refresh token candidate failed", {
        source: candidate.source,
        error: formatError(error),
      });
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

async function fetchLiveResult(requestId: string): Promise<EndpointResult> {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    logWithLevel("warn", requestId, "Spotify client credentials are missing");
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
    logWithLevel("info", requestId, "Fetching live Spotify playback data");

    const { accessToken } = await resolveSpotifySession(requestId);

    const nowPlayingResponse = await fetchFromSpotify(CURRENTLY_PLAYING_ENDPOINT, accessToken);
    logWithLevel("info", requestId, "Received currently-playing response", { status: nowPlayingResponse.status });

    if (nowPlayingResponse.status === 200) {
      const data = (await nowPlayingResponse.json()) as { is_playing?: boolean; item?: SpotifyTrack | null };
      const track = parseTrack(data.item);

      if (track.title || track.artist) {
        logWithLevel("info", requestId, "Returning currently playing track", {
          isPlaying: Boolean(data.is_playing),
          hasTitle: Boolean(track.title),
          hasArtist: Boolean(track.artist),
        });
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
      logWithLevel("info", requestId, "Currently-playing payload had no track metadata");
    } else if (nowPlayingResponse.status !== 204) {
      const snippet = await readResponseSnippet(nowPlayingResponse);
      logWithLevel("warn", requestId, "Unexpected currently-playing response status", {
        status: nowPlayingResponse.status,
        responseBody: snippet,
      });
      throw new Error(`Spotify currently-playing request failed with status ${nowPlayingResponse.status}`);
    }

    const recentlyPlayedResponse = await fetchFromSpotify(RECENTLY_PLAYED_ENDPOINT, accessToken);
    logWithLevel("info", requestId, "Received recently-played response", { status: recentlyPlayedResponse.status });

    if (recentlyPlayedResponse.status === 200) {
      const data = (await recentlyPlayedResponse.json()) as {
        items?: { track?: SpotifyTrack | null; played_at?: string }[];
      };
      const item = Array.isArray(data.items) ? data.items[0] : undefined;
      const track = parseTrack(item?.track);
      logWithLevel("info", requestId, "Returning recently played track", {
        hasTitle: Boolean(track.title),
        hasArtist: Boolean(track.artist),
        hasPlayedAt: typeof item?.played_at === "string",
      });

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
      const snippet = await readResponseSnippet(recentlyPlayedResponse);
      logWithLevel("warn", requestId, "Unexpected recently-played response status", {
        status: recentlyPlayedResponse.status,
        responseBody: snippet,
      });
      throw new Error(`Spotify recently-played request failed with status ${recentlyPlayedResponse.status}`);
    }

    logWithLevel("info", requestId, "Spotify returned no currently playing or recently played track");
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
  } catch (error) {
    logWithLevel("error", requestId, "Failed to fetch Spotify data", formatError(error));
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

async function getCachedOrFreshResult(requestId: string): Promise<EndpointResult> {
  const fromCache = readFreshCache();
  if (fromCache) {
    logWithLevel("info", requestId, "Serving Spotify response from cache", {
      source: fromCache.payload.source,
      status: fromCache.status,
    });
    return fromCache;
  }

  if (inFlightResponse) {
    logWithLevel("info", requestId, "Waiting for in-flight Spotify request");
    return inFlightResponse;
  }

  inFlightResponse = (async () => {
    const result = await fetchLiveResult(requestId);
    cachedResponse = buildCachedResult(result);
    logWithLevel("info", requestId, "Cached fresh Spotify response", {
      source: result.payload.source,
      status: result.status,
      ttlMs: cacheTtlFor(result),
    });
    return result;
  })();

  try {
    return await inFlightResponse;
  } finally {
    inFlightResponse = null;
  }
}

export const GET: APIRoute = async () => {
  const requestId = makeRequestId();
  logWithLevel("info", requestId, "Received /api/spotify request");
  try {
    const result = await getCachedOrFreshResult(requestId);
    logWithLevel("info", requestId, "Completed /api/spotify request", {
      status: result.status,
      source: result.payload.source,
    });
    return json(result.payload, result.status);
  } catch (error) {
    logWithLevel("error", requestId, "Unhandled /api/spotify error", formatError(error));
    return json(
      {
        source: "error",
        isPlaying: false,
        title: null,
        artist: null,
        songUrl: null,
        albumImageUrl: null,
        playedAt: null,
        message: "Unexpected server error while loading Spotify state.",
      },
      500,
    );
  }
};
