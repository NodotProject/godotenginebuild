export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return "under a minute";
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `~${h}h ${m}m` : `~${h}h`;
}

// Override with VITE_GH_ACTION_REF to pin a different tag/fork.
const GH_ACTION_REF = import.meta.env.VITE_GH_ACTION_REF ?? "NodotProject/godotenginebuild@v1";

// A GitHub Actions step that reproduces this exact build in a user's CI. The
// action is a thin client of this service: it posts these params, the server
// builds (or serves the cache), and the artifact is pulled into the runner.
export function ghActionConfig(args: {
  version: string;
  platform: string;
  options: string;
}): string {
  const serviceUrl =
    typeof window !== "undefined" ? window.location.origin : "https://your-service-url";
  return [
    "# Build a custom Godot export template in your CI.",
    "# The build runs on the Custom Godot Builds server; on a cache miss the",
    "# action waits for it, then downloads the artifact into the runner.",
    `- uses: ${GH_ACTION_REF}`,
    "  with:",
    `    service-url: ${JSON.stringify(serviceUrl)}`,
    `    version: ${JSON.stringify(args.version)}`,
    `    platform: ${args.platform}`,
    "    options: |",
    `      ${args.options}`,
  ].join("\n");
}
