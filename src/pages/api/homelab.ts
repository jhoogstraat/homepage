import type { APIRoute } from "astro";

export const prerender = false;

type Status = "running" | "degraded" | "exited" | "pending";

type RuntimeRow = {
  type: "containers" | "pods";
  name: string;
  image?: string;
  containers?: number;
  status: Status;
  cpu: string;
  memory: string;
  uptime: string;
};

type Snapshot = {
  source: "beszel" | "mock";
  syncedAt: string;
  summary: {
    hosts: number;
    containers: number;
    pods: number;
    alerts: number;
  };
  metrics: {
    cpu: number;
    memory: number;
    disk: number;
    thermal: number;
  };
  rows: RuntimeRow[];
};

const BESZEL_BASE_URL = import.meta.env.BESZEL_BASE_URL || "http://127.0.0.1:8090";
const HOMELAB_LOG_PREFIX = "[api/homelab]";

const COLLECTION_CANDIDATES = {
  containers: ["containers", "container_stats"],
  pods: ["pods", "podman_pods"],
};

const mockRows: RuntimeRow[] = [
  {
    type: "containers",
    name: "traefik-edge",
    image: "traefik:v3",
    status: "running",
    cpu: "3.8%",
    memory: "142MiB",
    uptime: "12d 04h",
  },
  {
    type: "containers",
    name: "gitea-app",
    image: "gitea/gitea:1.23",
    status: "running",
    cpu: "8.1%",
    memory: "512MiB",
    uptime: "8d 21h",
  },
  {
    type: "containers",
    name: "vaultwarden",
    image: "vaultwarden/server:1.33",
    status: "degraded",
    cpu: "21.4%",
    memory: "338MiB",
    uptime: "5d 13h",
  },
  {
    type: "containers",
    name: "grafana",
    image: "grafana/grafana:11.1",
    status: "running",
    cpu: "5.2%",
    memory: "406MiB",
    uptime: "14d 02h",
  },
  {
    type: "containers",
    name: "legacy-registry",
    image: "registry:2",
    status: "exited",
    cpu: "0.0%",
    memory: "0MiB",
    uptime: "stopped",
  },
  {
    type: "pods",
    name: "edge-stack",
    status: "running",
    containers: 3,
    cpu: "9.9%",
    memory: "812MiB",
    uptime: "12d 04h",
  },
  {
    type: "pods",
    name: "forge-stack",
    status: "running",
    containers: 2,
    cpu: "12.0%",
    memory: "724MiB",
    uptime: "8d 21h",
  },
  {
    type: "pods",
    name: "auth-stack",
    status: "degraded",
    containers: 2,
    cpu: "24.8%",
    memory: "701MiB",
    uptime: "5d 13h",
  },
  {
    type: "pods",
    name: "backup-stack",
    status: "pending",
    containers: 2,
    cpu: "1.1%",
    memory: "92MiB",
    uptime: "starting",
  },
];

function makeRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function logWithLevel(level: "info" | "warn" | "error", requestId: string, message: string, details?: unknown): void {
  const prefix = `${HOMELAB_LOG_PREFIX} [${requestId}] ${message}`;
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

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getPath(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  return path.split(".").reduce((current: unknown, key) => {
    if (current && typeof current === "object" && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function pickNumber(obj: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = toNumber(getPath(obj, path));
    if (value !== null) return value;
  }
  return null;
}

function pickString(obj: unknown, paths: string[], fallback = ""): string {
  for (const path of paths) {
    const value = getPath(obj, path);
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return fallback;
}

function normalizeStatus(value: unknown): Status {
  const status = String(value || "").toLowerCase();
  if (status.includes("running") || status.includes("up") || status.includes("healthy") || status.includes("active")) {
    return "running";
  }
  if (status.includes("degraded") || status.includes("warning") || status.includes("unhealthy") || status.includes("error")) {
    return "degraded";
  }
  if (status.includes("pending") || status.includes("starting") || status.includes("init") || status.includes("create")) {
    return "pending";
  }
  if (status.includes("exit") || status.includes("stopped") || status.includes("dead") || status.includes("inactive")) {
    return "exited";
  }
  return "running";
}

function formatPercent(value: unknown, fallback = "0.0%"): string {
  const parsed = toNumber(value);
  if (parsed === null) return fallback;
  return `${Math.max(0, parsed).toFixed(1)}%`;
}

function formatBytes(value: unknown, fallback = "0MiB"): string {
  const parsed = toNumber(value);
  if (parsed === null) return typeof value === "string" ? value : fallback;
  if (parsed <= 0) return "0MiB";
  const mib = parsed > 10_000 ? parsed / (1024 * 1024) : parsed;
  return `${Math.round(mib)}MiB`;
}

function formatUptime(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  const seconds = toNumber(value);
  if (seconds === null || seconds < 0) return "n/a";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = String(base || "").replace(/\/+$/, "");
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  return `${trimmedBase}/${normalizedPath}`;
}

async function fetchJson(url: string, requestId: string, timeout = 5000): Promise<unknown | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    logWithLevel("info", requestId, "Fetching Beszel URL", { url });
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 404) {
      logWithLevel("info", requestId, "Beszel URL returned 404", { url });
      return null;
    }
    if (!response.ok) {
      logWithLevel("warn", requestId, "Beszel URL returned non-OK status", {
        url,
        status: response.status,
      });
      throw new Error(`HTTP ${response.status}`);
    }

    logWithLevel("info", requestId, "Beszel URL returned JSON payload", {
      url,
      status: response.status,
    });
    return await response.json();
  } catch (error) {
    logWithLevel("warn", requestId, "Failed Beszel URL fetch", {
      url,
      error: formatError(error),
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchCollection(baseUrl: string, collectionName: string, requestId: string): Promise<Record<string, unknown>[] | null> {
  const url = joinUrl(baseUrl, `api/collections/${collectionName}/records?perPage=200&sort=-updated`);
  const data = await fetchJson(url, requestId);
  if (!data || typeof data !== "object" || !Array.isArray((data as { items?: unknown[] }).items)) {
    logWithLevel("info", requestId, "Collection payload missing items array", {
      collectionName,
      url,
    });
    return null;
  }
  const items = (data as { items: Record<string, unknown>[] }).items;
  logWithLevel("info", requestId, "Collection fetched", {
    collectionName,
    count: items.length,
  });
  return items;
}

async function fetchFirstCollection(baseUrl: string, candidates: string[], requestId: string, kind: "containers" | "pods"): Promise<Record<string, unknown>[]> {
  for (const candidate of candidates) {
    try {
      logWithLevel("info", requestId, "Trying Beszel collection candidate", {
        kind,
        candidate,
      });
      const items = await fetchCollection(baseUrl, candidate, requestId);
      if (items !== null) {
        logWithLevel("info", requestId, "Selected Beszel collection candidate", {
          kind,
          candidate,
          count: items.length,
        });
        return items;
      }
      logWithLevel("info", requestId, "Beszel collection candidate not available", {
        kind,
        candidate,
      });
    } catch (error) {
      logWithLevel("warn", requestId, "Beszel collection candidate failed; trying next", {
        kind,
        candidate,
        error: formatError(error),
      });
    }
  }
  logWithLevel("warn", requestId, "No Beszel collection candidate matched", { kind, candidates });
  return [];
}

function normalizeContainerRow(raw: Record<string, unknown>): RuntimeRow {
  const status = normalizeStatus(pickString(raw, ["status", "state", "container_status", "info.status"], "running"));
  const name = pickString(raw, ["name", "container", "container_name"], "unknown-container");

  return {
    type: "containers",
    name,
    image: pickString(raw, ["image", "image_name", "container_image"], "n/a"),
    status,
    cpu: formatPercent(pickNumber(raw, ["cpu", "cpu_percent", "stats.cpu", "info.cpu"])),
    memory: formatBytes(pickNumber(raw, ["memory", "mem", "memory_usage", "stats.memory", "info.memory"]), "n/a"),
    uptime: formatUptime(pickString(raw, ["uptime", "running_for", "started"]) || pickNumber(raw, ["uptime_seconds"])),
  };
}

function normalizePodRow(raw: Record<string, unknown>): RuntimeRow {
  const status = normalizeStatus(pickString(raw, ["status", "state", "pod_status", "info.status"], "running"));
  const name = pickString(raw, ["name", "pod", "pod_name"], "unknown-pod");

  return {
    type: "pods",
    name,
    containers: Math.max(0, Math.round(pickNumber(raw, ["containers", "container_count", "stats.containers"]) ?? 0)),
    status,
    cpu: formatPercent(pickNumber(raw, ["cpu", "cpu_percent", "stats.cpu", "info.cpu"])),
    memory: formatBytes(pickNumber(raw, ["memory", "mem", "memory_usage", "stats.memory", "info.memory"]), "n/a"),
    uptime: formatUptime(pickString(raw, ["uptime", "running_for", "started"]) || pickNumber(raw, ["uptime_seconds"])),
  };
}

function buildRuntimeRows(
  systems: Record<string, unknown>[],
  containerRecords: Record<string, unknown>[],
  podRecords: Record<string, unknown>[],
  requestId: string,
): RuntimeRow[] {
  const containers = containerRecords.map(normalizeContainerRow);
  const pods = podRecords.map(normalizePodRow);

  if (containers.length === 0 || pods.length === 0) {
    const embeddedContainers = systems.flatMap((system) => {
      const source = getPath(system, "containers") || getPath(system, "info.containers");
      return Array.isArray(source) ? (source as Record<string, unknown>[]) : [];
    });
    const embeddedPods = systems.flatMap((system) => {
      const source = getPath(system, "pods") || getPath(system, "info.pods");
      return Array.isArray(source) ? (source as Record<string, unknown>[]) : [];
    });

    if (containers.length === 0) {
      containers.push(...embeddedContainers.map(normalizeContainerRow));
      logWithLevel("info", requestId, "Using embedded system container data", {
        count: embeddedContainers.length,
      });
    }
    if (pods.length === 0) {
      pods.push(...embeddedPods.map(normalizePodRow));
      logWithLevel("info", requestId, "Using embedded system pod data", {
        count: embeddedPods.length,
      });
    }
  }

  return [...containers, ...pods];
}

function buildMetrics(systems: Record<string, unknown>[]): Snapshot["metrics"] {
  const primary = systems.find((system) => normalizeStatus((system as Record<string, unknown>).status) === "running") || systems[0];
  if (!primary) {
    return { cpu: 34, memory: 62, disk: 48, thermal: 57 };
  }

  return {
    cpu: Math.round(pickNumber(primary, ["info.cpu", "cpu", "stats.cpu"]) ?? 34),
    memory: Math.round(pickNumber(primary, ["info.mp", "info.memory", "memory", "stats.memory"]) ?? 62),
    disk: Math.round(pickNumber(primary, ["info.dp", "info.disk", "disk", "stats.disk"]) ?? 48),
    thermal: Math.round(pickNumber(primary, ["info.temp", "temperature", "stats.temp"]) ?? 57),
  };
}

function buildSummary(systems: Record<string, unknown>[], rows: RuntimeRow[]): Snapshot["summary"] {
  const containers = rows.filter((row) => row.type === "containers");
  const pods = rows.filter((row) => row.type === "pods");
  const alerts = rows.filter((row) => row.status === "degraded" || row.status === "pending");
  return {
    hosts: systems.length,
    containers: containers.length,
    pods: pods.length,
    alerts: alerts.length,
  };
}

function buildMockSnapshot(): Snapshot {
  return {
    source: "mock",
    syncedAt: new Date().toISOString(),
    summary: buildSummary([], mockRows),
    metrics: { cpu: 34, memory: 62, disk: 48, thermal: 57 },
    rows: mockRows,
  };
}

async function buildBeszelSnapshot(requestId: string): Promise<Snapshot> {
  logWithLevel("info", requestId, "Attempting Beszel snapshot", {
    baseUrl: BESZEL_BASE_URL,
  });
  const systems = await fetchCollection(BESZEL_BASE_URL, "systems", requestId);
  if (!systems || systems.length === 0) {
    logWithLevel("warn", requestId, "Beszel systems collection is empty or unavailable");
    throw new Error("No systems from Beszel");
  }
  logWithLevel("info", requestId, "Fetched systems from Beszel", { count: systems.length });

  const [containers, pods] = await Promise.all([
    fetchFirstCollection(BESZEL_BASE_URL, COLLECTION_CANDIDATES.containers, requestId, "containers"),
    fetchFirstCollection(BESZEL_BASE_URL, COLLECTION_CANDIDATES.pods, requestId, "pods"),
  ]);

  const rows = buildRuntimeRows(systems, containers, pods, requestId);
  const metrics = buildMetrics(systems);
  const summary = buildSummary(systems, rows);
  if (rows.length === 0) {
    logWithLevel("warn", requestId, "Beszel data produced zero runtime rows; using mock rows as fallback payload");
  }
  logWithLevel("info", requestId, "Built Beszel snapshot", {
    hosts: summary.hosts,
    containers: summary.containers,
    pods: summary.pods,
    alerts: summary.alerts,
    rows: rows.length,
  });

  return {
    source: "beszel",
    syncedAt: new Date().toISOString(),
    summary,
    metrics,
    rows: rows.length > 0 ? rows : mockRows,
  };
}

export const GET: APIRoute = async () => {
  const requestId = makeRequestId();
  logWithLevel("info", requestId, "Received /api/homelab request", {
    baseUrl: BESZEL_BASE_URL,
  });
  let snapshot: Snapshot;

  try {
    snapshot = await buildBeszelSnapshot(requestId);
  } catch (error) {
    logWithLevel("warn", requestId, "Falling back to mock homelab snapshot", {
      error: formatError(error),
      baseUrl: BESZEL_BASE_URL,
    });
    snapshot = buildMockSnapshot();
  }

  logWithLevel("info", requestId, "Completed /api/homelab request", {
    source: snapshot.source,
    hosts: snapshot.summary.hosts,
    containers: snapshot.summary.containers,
    pods: snapshot.summary.pods,
    alerts: snapshot.summary.alerts,
  });

  return new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};
