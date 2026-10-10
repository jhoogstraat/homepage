import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext, APIRoute } from "astro";
import { number, status } from "./homelab";
import { parseWeather, weatherCondition } from "./weather";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue({ code: "ENOENT" }),
  mkdir: vi.fn(), writeFile: vi.fn(), rename: vi.fn(),
}));
import { readFile, writeFile, rename } from "node:fs/promises";
const call = (get: APIRoute) => get({} as APIContext) as Promise<Response>;
const json = (data: unknown) => Response.json(data);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const name of ["BESZEL_BASE_URL", "BESZEL_PB_EMAIL", "BESZEL_PB_PASSWORD", "BESZEL_PB_AUTH_PATH", "SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN"]) vi.stubEnv(name, "");
  vi.stubEnv("BESZEL_SYSTEM_NAME", "pi1");
  vi.stubEnv("SPOTIFY_RESPONSE_CACHE_TTL_MS", "30000");
  vi.stubEnv("SPOTIFY_TOKEN_STORE_PATH", "/tmp/spotify-test-token.json");
  vi.mocked(readFile).mockRejectedValue({ code: "ENOENT" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("homelab", () => {
  it("does not misreport unhealthy or inactive containers as running", () => {
    expect(status("unhealthy")).toBe("degraded");
    expect(status("inactive")).toBe("exited");
    expect(status("down")).toBe("exited");
    expect(status("Up 3 days", 3)).toBe("degraded");
    expect(status("Up 3 seconds", 1)).toBe("pending");
    expect(status("Up 3 days (healthy)")).toBe("running");
    expect(status("starting")).toBe("pending");
    expect(status(null)).toBe("pending");
    expect([number(null), number(""), number("12abc"), number(-1), number(Infinity)]).toEqual([null, null, null, null, null]);
    expect(number("42.5")).toBe(42.5);
  });

  it("returns unavailable without invented telemetry or network calls when unconfigured", async () => {
    const { GET } = await import("../pages/api/homelab");
    const response = await call(GET);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ source: "unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("scopes containers to the selected system, caches concurrent requests and retains unknown metrics", async () => {
    vi.stubEnv("BESZEL_BASE_URL", "https://beszel.example");
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ items: [{ id: "system-1", name: "pi1", status: "up", host: "10.0.0.1", updated: "2026-10-10T12:00:00Z", info: { cpu: 100, mp: 105, dp: null, dt: 57 } }] }))
      .mockResolvedValueOnce(json({ items: [{ name: "web", image: "nginx", status: "Up 3 days", health: 3, cpu: 3.8, memory: 142 }] }));
    const { GET } = await import("../pages/api/homelab");
    const responses = await Promise.all([call(GET), call(GET)]);
    const data = await responses[0].json();
    expect(data.metrics).toEqual({ cpu: 100, memory: null, disk: null, thermal: 57 });
    expect(data.rows[0].status).toBe("degraded");
    expect(JSON.stringify(data)).not.toContain("10.0.0.1");
    expect(new URL(vi.mocked(fetch).mock.calls[1][0] as string).searchParams.get("filter")).toBe("system='system-1'");
    await call(GET);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not report stale containers or metrics as live when the host is down", async () => {
    vi.stubEnv("BESZEL_BASE_URL", "https://beszel.example");
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ items: [{ id: "system-1", name: "pi1", status: "down", info: { cpu: 45, mp: 60 } }] }))
      .mockResolvedValueOnce(json({ items: [{ name: "web", status: "Up 3 days", cpu: 5, memory: 100 }] }));
    const { GET } = await import("../pages/api/homelab");
    const data = await (await call(GET)).json();
    expect(data.systemStatus).toBe("exited");
    expect(data.metrics).toEqual({ cpu: null, memory: null, disk: null, thermal: null });
    expect(data.rows[0]).toMatchObject({ status: "pending", cpu: null, memory: null });
  });

  it("fails closed on authentication errors and never publishes upstream error details", async () => {
    vi.stubEnv("BESZEL_BASE_URL", "https://beszel.example");
    vi.stubEnv("BESZEL_PB_EMAIL", "owner@example.com");
    vi.stubEnv("BESZEL_PB_PASSWORD", "private-password");
    vi.mocked(fetch).mockResolvedValue(new Response("private-password", { status: 401 }));
    const { GET } = await import("../pages/api/homelab");
    const response = await call(GET);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-password");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("spotify", () => {
  function configure() {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "client");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
    vi.stubEnv("SPOTIFY_REFRESH_TOKEN", "initial-token");
  }
  it("returns a clean unconfigured response without upstream requests", async () => {
    const { GET } = await import("../pages/api/spotify");
    const response = await call(GET);
    expect(response.status).toBe(200);
    expect((await response.json()).source).toBe("unconfigured");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("coalesces requests and persists a rotated token atomically with private permissions", async () => {
    configure();
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ access_token: "access", refresh_token: "rotated" }))
      .mockResolvedValueOnce(json({ is_playing: true, item: { name: " Song ", artists: [{ name: "Artist" }] } }));
    const { GET } = await import("../pages/api/spotify");
    const responses = await Promise.all([call(GET), call(GET)]);
    expect(await responses[0].json()).toMatchObject({ source: "spotify", isPlaying: true, title: "Song", artist: "Artist" });
    expect(writeFile).toHaveBeenCalledWith("/tmp/spotify-test-token.json.tmp", expect.stringContaining('"refreshToken":"rotated"'), { mode: 0o600 });
    expect(rename).toHaveBeenCalledWith("/tmp/spotify-test-token.json.tmp", "/tmp/spotify-test-token.json");
    expect(await responses[1].text()).not.toContain("rotated");
    await call(GET);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back from a revoked stored token and returns the last played song when idle", async () => {
    configure();
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ refreshToken: "revoked" }));
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(json({ access_token: "access" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ items: [{ track: { name: "Recent", artists: [{ name: "Artist" }] }, played_at: "2026-10-10T12:00:00Z" }] }));
    const { GET } = await import("../pages/api/spotify");
    expect(await (await call(GET)).json()).toMatchObject({ source: "spotify", title: "Recent", isPlaying: false, playedAt: "2026-10-10T12:00:00Z" });
    expect(String(vi.mocked(fetch).mock.calls[1][1]?.body)).toContain("refresh_token=initial-token");
  });

  it("caches failures and does not leak upstream errors or credentials", async () => {
    configure();
    vi.mocked(fetch).mockRejectedValue(new Error("secret access token"));
    const { GET } = await import("../pages/api/spotify");
    const response = await call(GET);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret");
    await call(GET);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});


describe("weather", () => {
  const current = { temperature_2m: -4.5, relative_humidity_2m: 82, wind_speed_10m: 12.4, weather_code: 73, time: 1791633600, is_day: 0 };
  it("preserves negative temperatures and validates upstream values", () => {
    expect(parseWeather({ current })).toMatchObject({ temperature: -4.5, humidity: 82, code: 73, isDay: false });
    for (const invalid of [{ temperature_2m: null }, { relative_humidity_2m: 101 }, { wind_speed_10m: -1 }, { is_day: 2 }]) {
      expect(() => parseWeather({ current: { ...current, ...invalid } })).toThrow();
    }
    expect(weatherCondition(73).key).toBe("snow");
    expect(weatherCondition(67).key).toBe("freezing");
    expect(weatherCondition(99).key).toBe("storm");
    expect(weatherCondition(999).key).toBe("unknown");
  });
  it("coalesces and caches real weather with explicit units and location", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ current }));
    const { GET } = await import("../pages/api/weather");
    const responses = await Promise.all([call(GET), call(GET)]);
    expect(responses[0].status).toBe(200);
    expect(await responses[0].json()).toMatchObject({ temperature: -4.5, code: 73 });
    expect(await responses[1].json()).toMatchObject({ temperature: -4.5 });
    await call(GET);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url.searchParams.get("latitude")).toBe("52.52");
    expect(url.searchParams.get("timeformat")).toBe("unixtime");
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it("caches upstream failures without fabricated readings", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("upstream details", { status: 500 }));
    const { GET } = await import("../pages/api/weather");
    const response = await call(GET);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ source: "unavailable" });
    await call(GET);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
