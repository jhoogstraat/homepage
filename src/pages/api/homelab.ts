import type { APIRoute } from "astro";

export const prerender = false;

type Status = "running" | "degraded" | "exited" | "pending";

type RuntimeRow = {
  type: "containers";
  name: string;
  image?: string;
  status: Status;
  cpu: string;
  memory: string;
  uptime: string;
};

type SystemDetails = {
  name: string;
  host: string;
  specs: string;
  arch: string | null;
  cpu: string | null;
  cores: number | null;
  threads: number | null;
  memoryBytes: number | null;
  osName: string | null;
  kernel: string | null;
  updated: string | null;
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
  system: SystemDetails | null;
};

type FetchOptions = {
  perPage?: number;
  sort?: string;
  filter?: string;
};

const HOMELAB_LOG_PREFIX = "[api/homelab]";
const BESZEL_BASE_URL_FALLBACK = "http://127.0.0.1:8090";
const BESZEL_AUTH_PATH_FALLBACK = "api/collections/users/auth-with-password";
const BESZEL_SYSTEM_NAME_FALLBACK = "pi1";
const RESPONSE_SNIPPET_MAX_LENGTH = 400;

const mockRows: RuntimeRow[] = [
  {
    type: "containers",
    name: "traefik-edge",
    image: "traefik:v3",
    status: "running",
    cpu: "3.8%",
    memory: "142MiB",
    uptime: "Up 12d",
  },
  {
    type: "containers",
    name: "gitea-app",
    image: "gitea/gitea:1.23",
    status: "running",
    cpu: "8.1%",
    memory: "512MiB",
    uptime: "Up 8d",
  },
  {
    type: "containers",
    name: "vaultwarden",
    image: "vaultwarden/server:1.33",
    status: "degraded",
    cpu: "21.4%",
    memory: "338MiB",
    uptime: "Up 5d",
  },
  {
    type: "containers",
    name: "grafana",
    image: "grafana/grafana:11.1",
    status: "running",
    cpu: "5.2%",
    memory: "406MiB",
    uptime: "Up 14d",
  },
  {
    type: "containers",
    name: "legacy-registry",
    image: "registry:2",
    status: "exited",
    cpu: "0.0%",
    memory: "0MiB",
    uptime: "Exited",
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

function resolveRuntimeEnv(name: string): string | undefined {
  const processEnv = typeof process !== "undefined" ? process.env : undefined;
  const runtimeValue = processEnv?.[name];
  if (typeof runtimeValue === "string" && runtimeValue.trim().length > 0) {
    return runtimeValue.trim();
  }

  const buildValue = import.meta.env[name];
  if (typeof buildValue === "string" && buildValue.trim().length > 0) {
    return buildValue.trim();
  }

  return undefined;
}

function resolveBeszelBaseUrl(): string {
  return resolveRuntimeEnv("BESZEL_BASE_URL") || BESZEL_BASE_URL_FALLBACK;
}

function resolveBeszelSystemName(): string {
  return resolveRuntimeEnv("BESZEL_SYSTEM_NAME") || BESZEL_SYSTEM_NAME_FALLBACK;
}

function resolveBeszelAuthConfig(): { email?: string; password?: string; authPath: string } {
  return {
    email: resolveRuntimeEnv("BESZEL_PB_EMAIL"),
    password: resolveRuntimeEnv("BESZEL_PB_PASSWORD"),
    authPath: resolveRuntimeEnv("BESZEL_PB_AUTH_PATH") || BESZEL_AUTH_PATH_FALLBACK,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
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
  if (parsed === null) return fallback;
  if (parsed <= 0) return "0MiB";
  const mib = parsed > 10_000 ? parsed / (1024 * 1024) : parsed;
  return `${Math.round(mib)}MiB`;
}

function formatMemoryBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return "mem n/a";
  const gib = bytes / (1024 ** 3);
  if (gib >= 1) {
    const rounded = gib >= 10 ? Math.round(gib) : Math.round(gib * 10) / 10;
    return `${rounded} GiB`;
  }
  return `${Math.round(bytes / (1024 ** 2))} MiB`;
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = String(base || "").replace(/\/+$/, "");
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  return `${trimmedBase}/${normalizedPath}`;
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildCollectionUrl(baseUrl: string, collectionName: string, options: FetchOptions = {}): string {
  const params = new URLSearchParams();
  params.set("perPage", String(options.perPage ?? 200));
  if (options.sort) params.set("sort", options.sort);
  if (options.filter) params.set("filter", options.filter);
  return joinUrl(baseUrl, `api/collections/${collectionName}/records?${params.toString()}`);
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

async function resolveBeszelAuthToken(baseUrl: string, requestId: string): Promise<string | null> {
  const authConfig = resolveBeszelAuthConfig();
  const hasEmail = Boolean(authConfig.email);
  const hasPassword = Boolean(authConfig.password);

  if (!hasEmail || !hasPassword) {
    logWithLevel("info", requestId, "PocketBase auth credentials not fully configured; using unauthenticated Beszel requests", {
      hasEmail,
      hasPassword,
    });
    return null;
  }

  const authUrl = joinUrl(baseUrl, authConfig.authPath);
  logWithLevel("info", requestId, "Authenticating against PocketBase", {
    authUrl,
  });

  const response = await fetch(authUrl, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identity: authConfig.email,
      password: authConfig.password,
    }),
  });

  if (!response.ok) {
    const snippet = await readResponseSnippet(response);
    logWithLevel("warn", requestId, "PocketBase authentication failed", {
      status: response.status,
      authUrl,
      responseBody: snippet,
    });
    throw new Error(`PocketBase authentication failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { token?: unknown };
  if (typeof payload.token !== "string" || payload.token.trim().length === 0) {
    throw new Error("PocketBase authentication response is missing token");
  }

  logWithLevel("info", requestId, "PocketBase authentication succeeded");
  return payload.token;
}

async function fetchJson(url: string, requestId: string, authToken?: string, timeout = 5000): Promise<unknown | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    logWithLevel("info", requestId, "Fetching Beszel URL", {
      url,
      authenticated: Boolean(authToken),
    });
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    });

    if (response.status === 404) {
      logWithLevel("info", requestId, "Beszel URL returned 404", { url });
      return null;
    }
    if (!response.ok) {
      const snippet = await readResponseSnippet(response);
      logWithLevel("warn", requestId, "Beszel URL returned non-OK status", {
        url,
        status: response.status,
        responseBody: snippet,
      });
      throw new Error(`HTTP ${response.status}`);
    }

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

async function fetchCollection(
  baseUrl: string,
  collectionName: string,
  requestId: string,
  authToken?: string,
  options: FetchOptions = {},
): Promise<Record<string, unknown>[] | null> {
  const url = buildCollectionUrl(baseUrl, collectionName, options);
  const data = await fetchJson(url, requestId, authToken);
  const record = asRecord(data);
  const items = record?.items;
  if (!Array.isArray(items)) {
    logWithLevel("info", requestId, "Collection payload missing items array", {
      collectionName,
      url,
    });
    return null;
  }

  const typedItems = items
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  logWithLevel("info", requestId, "Collection fetched", {
    collectionName,
    count: typedItems.length,
  });

  return typedItems;
}

async function fetchRecordByName(
  baseUrl: string,
  collectionName: string,
  name: string,
  requestId: string,
  authToken?: string,
): Promise<Record<string, unknown> | null> {
  return fetchSingleRecordByFilter(
    baseUrl,
    collectionName,
    `name='${escapeFilterValue(name)}'`,
    requestId,
    authToken,
  );
}

async function fetchSingleRecordByFilter(
  baseUrl: string,
  collectionName: string,
  filter: string,
  requestId: string,
  authToken?: string,
): Promise<Record<string, unknown> | null> {
  const items = await fetchCollection(baseUrl, collectionName, requestId, authToken, {
    perPage: 1,
    sort: "-updated",
    filter,
  });

  if (!items || items.length === 0) {
    logWithLevel("warn", requestId, "No record found for collection/name", {
      collectionName,
      name,
    });
    return null;
  }

  return items[0];
}

function normalizeContainerRow(raw: Record<string, unknown>): RuntimeRow {
  const statusText = asString(raw.status) || "";
  return {
    type: "containers",
    name: asString(raw.name) || "unknown-container",
    image: asString(raw.image) || "n/a",
    status: normalizeStatus(statusText),
    cpu: formatPercent(raw.cpu),
    memory: formatBytes(raw.memory),
    uptime: statusText || "n/a",
  };
}

function buildMetrics(systemRecord: Record<string, unknown> | null): Snapshot["metrics"] {
  if (!systemRecord) {
    return { cpu: 34, memory: 62, disk: 48, thermal: 57 };
  }

  const info = asRecord(systemRecord.info);
  return {
    cpu: Math.round(toNumber(info?.cpu) ?? 34),
    memory: Math.round(toNumber(info?.mp) ?? 62),
    disk: Math.round(toNumber(info?.dp) ?? 48),
    thermal: Math.round(toNumber(info?.dt) ?? 57),
  };
}

function buildSummary(systemRecord: Record<string, unknown> | null, rows: RuntimeRow[]): Snapshot["summary"] {
  const alerts = rows.filter((row) => row.status === "degraded" || row.status === "pending");
  return {
    hosts: systemRecord ? 1 : 0,
    containers: rows.length,
    pods: 0,
    alerts: alerts.length,
  };
}

function buildSystemDetails(
  systemName: string,
  systemRecord: Record<string, unknown> | null,
  detailsRecord: Record<string, unknown> | null,
): SystemDetails | null {
  if (!systemRecord && !detailsRecord) return null;

  const name = asString(systemRecord?.name) || systemName;
  const host = asString(detailsRecord?.hostname) || asString(systemRecord?.host) || "n/a";
  const cpu = asString(detailsRecord?.cpu);
  const arch = asString(detailsRecord?.arch);
  const osName = asString(detailsRecord?.os_name);
  const kernel = asString(detailsRecord?.kernel);
  const cores = toNumber(detailsRecord?.cores);
  const threads = toNumber(detailsRecord?.threads);
  const memoryBytes = toNumber(detailsRecord?.memory);
  const updated = asString(detailsRecord?.updated) || asString(systemRecord?.updated);

  const coreSpec = cores !== null
    ? `${Math.round(cores)}C/${Math.round(threads ?? cores)}T`
    : null;

  const specsParts = [
    cpu,
    coreSpec,
    formatMemoryBytes(memoryBytes),
    osName,
    arch,
  ].filter((part): part is string => Boolean(part && part.trim().length > 0));

  return {
    name,
    host,
    specs: specsParts.length > 0 ? specsParts.join(" · ") : "n/a",
    arch,
    cpu,
    cores: cores === null ? null : Math.round(cores),
    threads: threads === null ? null : Math.round(threads),
    memoryBytes,
    osName,
    kernel,
    updated: updated || null,
  };
}

function buildMockSnapshot(): Snapshot {
  return {
    source: "mock",
    syncedAt: new Date().toISOString(),
    summary: {
      hosts: 1,
      containers: mockRows.length,
      pods: 0,
      alerts: mockRows.filter((row) => row.status === "degraded" || row.status === "pending").length,
    },
    metrics: { cpu: 34, memory: 62, disk: 48, thermal: 57 },
    rows: mockRows,
    system: {
      name: BESZEL_SYSTEM_NAME_FALLBACK,
      host: "beszel",
      specs: "Cortex-A72 · 4C/4T · 7.6 GiB · fedora · aarch64",
      arch: "aarch64",
      cpu: "Cortex-A72",
      cores: 4,
      threads: 4,
      memoryBytes: 8147894272,
      osName: "fedora",
      kernel: "6.18.3-200.fc43.aarch64",
      updated: new Date().toISOString(),
    },
  };
}

async function buildBeszelSnapshot(baseUrl: string, requestId: string): Promise<Snapshot> {
  const systemName = resolveBeszelSystemName();

  logWithLevel("info", requestId, "Attempting strict Beszel snapshot with system-scoped filters", {
    baseUrl,
    systemName,
    collections: ["containers", "systems", "system_details"],
  });

  const authToken = await resolveBeszelAuthToken(baseUrl, requestId);

  const systemRecord = await fetchRecordByName(baseUrl, "systems", systemName, requestId, authToken);
  if (!systemRecord) {
    throw new Error(`System '${systemName}' not found`);
  }

  const systemId = asString(systemRecord.id);
  if (!systemId) {
    throw new Error(`System '${systemName}' record is missing id`);
  }

  const systemFilter = `system='${escapeFilterValue(systemId)}'`;
  logWithLevel("info", requestId, "Resolved system id for filters", {
    systemName,
    systemId,
    systemFilter,
  });

  const containers = await fetchCollection(baseUrl, "containers", requestId, authToken, {
    perPage: 200,
    sort: "-updated",
    filter: systemFilter,
  });
  if (!containers) {
    throw new Error("Containers collection unavailable");
  }

  const rows = containers.map(normalizeContainerRow);
  const detailsRecord = await fetchSingleRecordByFilter(baseUrl, "system_details", systemFilter, requestId, authToken);

  const metrics = buildMetrics(systemRecord);
  const summary = buildSummary(systemRecord, rows);
  const system = buildSystemDetails(systemName, systemRecord, detailsRecord);

  logWithLevel("info", requestId, "Built strict Beszel snapshot", {
    hosts: summary.hosts,
    containers: summary.containers,
    pods: summary.pods,
    alerts: summary.alerts,
    hasSystem: Boolean(system),
  });

  return {
    source: "beszel",
    syncedAt: new Date().toISOString(),
    summary,
    metrics,
    rows,
    system,
  };
}

export const GET: APIRoute = async () => {
  const requestId = makeRequestId();
  const baseUrl = resolveBeszelBaseUrl();

  logWithLevel("info", requestId, "Received /api/homelab request", {
    baseUrl,
  });

  let snapshot: Snapshot;

  try {
    snapshot = await buildBeszelSnapshot(baseUrl, requestId);
  } catch (error) {
    logWithLevel("warn", requestId, "Falling back to mock homelab snapshot", {
      error: formatError(error),
      baseUrl,
    });
    snapshot = buildMockSnapshot();
  }

  logWithLevel("info", requestId, "Completed /api/homelab request", {
    source: snapshot.source,
    hosts: snapshot.summary.hosts,
    containers: snapshot.summary.containers,
    pods: snapshot.summary.pods,
    alerts: snapshot.summary.alerts,
    system: snapshot.system?.specs || null,
  });

  return new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};
