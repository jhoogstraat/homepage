export type Status = "running" | "degraded" | "exited" | "pending";
export interface RuntimeRow {
  name: string;
  image: string;
  status: Status;
  cpu: number | null;
  memory: number | null;
}
export interface Snapshot {
  syncedAt: string;
  system: string;
  systemStatus: Status;
  metrics: Record<"cpu" | "memory" | "disk" | "thermal", number | null>;
  rows: RuntimeRow[];
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function number(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
export function status(value: unknown, health?: unknown): Status {
  const text = String(value ?? "").toLowerCase();
  if (/unhealthy|degraded|warning|error/.test(text)) return "degraded";
  if (/inactive|exit|stopped|dead|^down$/.test(text)) return "exited";
  if (health === 3) return "degraded";
  if (health === 1) return "pending";
  if (/pending|starting|init|creat/.test(text)) return "pending";
  if (/\b(running|up|healthy|active)\b/.test(text)) return "running";
  return "pending";
}
