import type { APIRoute } from "astro";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const prerender = false;

type Track = {
  name?: string;
  artists?: { name?: string }[];
  external_urls?: { spotify?: string };
  album?: { images?: { url?: string }[] };
};
type Payload = {
  source: "spotify" | "unconfigured" | "error";
  isPlaying: boolean;
  title: string | null;
  artist: string | null;
  songUrl: string | null;
  albumImageUrl: string | null;
  playedAt: string | null;
};
type Result = { status: number; payload: Payload };
const empty: Omit<Payload, "source"> = {
  isPlaying: false, title: null, artist: null, songUrl: null, albumImageUrl: null, playedAt: null,
};
let cache: (Result & { expires: number }) | null = null;
let pending: Promise<Result> | null = null;
let latestRefreshToken: string | null = null;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function trackFields(track?: Track | null) {
  return {
    title: text(track?.name),
    artist: Array.isArray(track?.artists) ? track.artists.map((artist) => text(artist?.name)).filter(Boolean).join(", ") || null : null,
    songUrl: text(track?.external_urls?.spotify),
    albumImageUrl: text(track?.album?.images?.[0]?.url),
  };
}
function ttl(source: Payload["source"]): number {
  const [name, fallback] = source === "error" ? ["SPOTIFY_RESPONSE_ERROR_CACHE_TTL_MS", 5000]
    : source === "unconfigured" ? ["SPOTIFY_UNCONFIGURED_CACHE_TTL_MS", 60_000]
    : ["SPOTIFY_RESPONSE_CACHE_TTL_MS", 30_000];
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function session(clientId: string, clientSecret: string): Promise<string | null> {
  const path = resolve(process.env.SPOTIFY_TOKEN_STORE_PATH || ".spotify/refresh-token.json");
  let stored: string | null = null;
  try {
    stored = text(JSON.parse(await readFile(path, "utf8")).refreshToken);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      console.warn("[spotify] Unable to read token store");
    }
  }
  const tokens = [...new Set([latestRefreshToken, stored, text(process.env.SPOTIFY_REFRESH_TOKEN)].filter((token): token is string => Boolean(token)))];
  if (!tokens.length) return null;
  for (const token of tokens) {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token }),
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) continue;
      throw new Error(`Spotify token endpoint returned ${response.status}`);
    }
    const data = await response.json();
    const access = text(data.access_token);
    if (!access) throw new Error("Missing Spotify access token");
    latestRefreshToken = text(data.refresh_token) || token;
    if (latestRefreshToken !== stored) {
      try {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(`${path}.tmp`, JSON.stringify({ refreshToken: latestRefreshToken, updatedAt: new Date().toISOString() }), { mode: 0o600 });
        await rename(`${path}.tmp`, path);
      } catch { console.warn("[spotify] Unable to persist refresh token"); }
    }
    return access;
  }
  throw new Error("Spotify rejected refresh tokens");
}

async function load(): Promise<Result> {
  const clientId = text(process.env.SPOTIFY_CLIENT_ID);
  const clientSecret = text(process.env.SPOTIFY_CLIENT_SECRET);
  if (!clientId || !clientSecret) return { status: 200, payload: { source: "unconfigured", ...empty } };
  try {
    const access = await session(clientId, clientSecret);
    if (!access) return { status: 200, payload: { source: "unconfigured", ...empty } };
    async function request(path: string): Promise<Response> {
      const response = await fetch(`https://api.spotify.com/v1/me/${path}`, {
        signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!response.ok) throw new Error(`Spotify returned ${response.status}`);
      return response;
    }
    const current = await request("player/currently-playing");
    if (current.status !== 204) {
      const data = await current.json();
      const track = trackFields(data.item);
      if (track.title || track.artist) return { status: 200, payload: { source: "spotify", ...empty, ...track, isPlaying: data.is_playing === true } };
    }
    const recent = await request("player/recently-played?limit=1");
    const data = recent.status === 204 ? {} : await recent.json();
    const item = Array.isArray(data.items) ? data.items[0] : undefined;
    return { status: 200, payload: { source: "spotify", ...empty, ...trackFields(item?.track), playedAt: text(item?.played_at) } };
  } catch {
    console.warn("[spotify] Playback request failed");
    return { status: 502, payload: { source: "error", ...empty } };
  }
}

export const GET: APIRoute = async () => {
  if (!cache || cache.expires <= Date.now()) {
    pending ??= load().then((result) => {
      cache = { ...result, expires: Date.now() + ttl(result.payload.source) };
      return result;
    }).finally(() => { pending = null; });
    await pending;
  }
  return Response.json(cache!.payload, { status: cache!.status, headers: { "Cache-Control": "no-store" } });
};
