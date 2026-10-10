import type { APIRoute } from "astro";
import { parseWeather, type WeatherSnapshot } from "@/src/lib/weather";

export const prerender = false;
type Result = { status: number; data: WeatherSnapshot | { source: "unavailable" }; expires: number };
let cache: Result | null = null;
let pending: Promise<Result> | null = null;

async function load(): Promise<Result> {
  try {
    const query = new URLSearchParams({
      latitude: "52.52", longitude: "13.41",
      current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
      temperature_unit: "celsius", wind_speed_unit: "kmh", timeformat: "unixtime",
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Weather unavailable");
    return { status: 200, data: parseWeather(await response.json()), expires: Date.now() + 15 * 60_000 };
  } catch {
    return { status: 503, data: { source: "unavailable" }, expires: Date.now() + 60_000 };
  }
}

export const GET: APIRoute = async () => {
  if (!cache || cache.expires <= Date.now()) {
    pending ??= load().then((result) => cache = result).finally(() => { pending = null; });
    await pending;
  }
  return Response.json(cache!.data, { status: cache!.status, headers: { "Cache-Control": "no-store" } });
};
