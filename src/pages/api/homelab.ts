import type { APIRoute } from "astro";
import { number, record, status, type Snapshot } from "@/src/lib/homelab";

export const prerender = false;
let cache: { snapshot: Snapshot; expires: number } | null = null;
let pending: Promise<Snapshot> | null = null;

async function loadSnapshot(): Promise<Snapshot> {
  const base = process.env.BESZEL_BASE_URL?.trim();
  if (!base) throw new Error("Beszel is not configured");
  let token: string | undefined;
  async function request(path: string, options?: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetch(`${base!.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`, {
      ...options,
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers },
    });
    if (!response.ok) throw new Error(`Beszel returned ${response.status}`);
    return record(await response.json());
  }
  const email = process.env.BESZEL_PB_EMAIL;
  const password = process.env.BESZEL_PB_PASSWORD;
  if (email || password) {
    if (!email || !password) throw new Error("Incomplete Beszel credentials");
    const auth = await request(process.env.BESZEL_PB_AUTH_PATH || "api/collections/users/auth-with-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
    });
    if (typeof auth.token !== "string" || !auth.token.trim()) throw new Error("Missing Beszel token");
    token = auth.token;
  }
  async function collection(name: string, filter: string, perPage: number): Promise<Record<string, unknown>[]> {
    const query = new URLSearchParams({ filter, perPage: String(perPage), sort: "-updated" });
    const data = await request(`api/collections/${name}/records?${query}`);
    if (!Array.isArray(data.items)) throw new Error("Invalid Beszel collection");
    return data.items.map(record);
  }
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const name = process.env.BESZEL_SYSTEM_NAME?.trim() || "pi1";
  const [system] = await collection("systems", `name='${escape(name)}'`, 1);
  if (!system || typeof system.id !== "string" || !system.id) throw new Error("Missing Beszel system");
  const containers = await collection("containers", `system='${escape(system.id)}'`, 200);
  const systemStatus = status(system.status);
  const info = systemStatus === "running" ? record(system.info) : {};
  const metrics = { cpu: number(info.cpu), memory: number(info.mp), disk: number(info.dp), thermal: number(info.dt) };
  for (const key of ["cpu", "memory", "disk"] as const) {
    if (metrics[key] !== null && metrics[key]! > 100) metrics[key] = null;
  }
  return {
    syncedAt: typeof system.updated === "string" && Number.isFinite(Date.parse(system.updated)) ? new Date(system.updated).toISOString() : "",
    system: typeof system.name === "string" ? system.name : name,
    systemStatus,
    metrics,
    rows: containers.map((row) => ({
      name: typeof row.name === "string" ? row.name : "—",
      image: typeof row.image === "string" ? row.image : "—",
      status: systemStatus === "running" ? status(row.status, row.health) : "pending",
      cpu: systemStatus === "running" ? number(row.cpu) : null,
      memory: systemStatus === "running" ? number(row.memory) : null,
    })),
  };
}

export const GET: APIRoute = async () => {
  try {
    if (!cache || cache.expires <= Date.now()) {
      pending ??= loadSnapshot().then((snapshot) => {
        cache = { snapshot, expires: Date.now() + 30_000 };
        return snapshot;
      }).finally(() => { pending = null; });
      await pending;
    }
    return Response.json(cache!.snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ source: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
};
