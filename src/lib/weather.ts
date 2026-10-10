export interface WeatherSnapshot {
  temperature: number;
  humidity: number;
  wind: number;
  code: number;
  isDay: boolean;
  updatedAt: string;
}

export function parseWeather(value: unknown): WeatherSnapshot {
  if (!value || typeof value !== "object" || !("current" in value)) throw new Error("Missing weather data");
  const current = value.current as Record<string, unknown> | null;
  const fields = ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "weather_code", "time", "is_day"] as const;
  if (!current || fields.some((key) => typeof current[key] !== "number" || !Number.isFinite(current[key]))) throw new Error("Invalid weather data");
  const { temperature_2m: temperature, relative_humidity_2m: humidity, wind_speed_10m: wind, weather_code: code, time, is_day: isDay } = current as Record<typeof fields[number], number>;
  if (humidity < 0 || humidity > 100 || wind < 0 || !Number.isInteger(code) || code < 0 || (isDay !== 0 && isDay !== 1)) throw new Error("Invalid weather values");
  return { temperature, humidity, wind, code, isDay: isDay === 1, updatedAt: new Date(time * 1000).toISOString() };
}

export function weatherCondition(code: number) {
  const groups = [
    [[0], "clear", "☀️"], [[1], "mostlyClear", "🌤️"], [[2], "partlyCloudy", "⛅"], [[3], "overcast", "☁️"],
    [[45, 48], "fog", "🌫️"], [[51, 53, 55], "drizzle", "🌧️"], [[56, 57, 66, 67], "freezing", "🧊"],
    [[61, 63, 65], "rain", "🌧️"], [[71, 73, 75, 77], "snow", "🌨️"], [[80, 81, 82], "showers", "🌦️"],
    [[85, 86], "snowShowers", "🌨️"], [[95, 96, 97, 99], "storm", "⛈️"],
  ] as const;
  const group = groups.find(([codes]) => (codes as readonly number[]).includes(code));
  return { key: group?.[1] ?? "unknown", icon: group?.[2] ?? "🌡️" } as const;
}
