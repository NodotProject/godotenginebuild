import type {
  BuildCheckRequest,
  BuildCheckResponse,
  BuildRequest,
  BuildResponse,
  JobInfo,
  OptionCatalog,
  VersionsResponse,
} from "@godotbuild/shared";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function getVersions(): Promise<VersionsResponse> {
  return fetch("/api/versions").then((r) => json<VersionsResponse>(r));
}

export function getCatalog(version: string): Promise<OptionCatalog> {
  return fetch(`/api/catalog?version=${encodeURIComponent(version)}`).then((r) =>
    json<OptionCatalog>(r),
  );
}

export function checkBuilds(body: BuildCheckRequest): Promise<BuildCheckResponse> {
  return fetch("/api/builds/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<BuildCheckResponse>(r));
}

export function createBuilds(body: BuildRequest): Promise<BuildResponse> {
  return fetch("/api/builds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<BuildResponse>(r));
}

/** Fetch the current status of a previously created job. 404 -> null. */
export async function getJob(jobId: string): Promise<JobInfo | null> {
  const res = await fetch(`/api/builds/${encodeURIComponent(jobId)}`);
  if (res.status === 404) return null;
  return json<JobInfo>(res);
}
