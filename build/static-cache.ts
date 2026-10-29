import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite-plus";

interface ManifestEntry {
  file?: string;
  css?: string[];
}

/** Only emitted, fingerprinted code referenced by this client build can be reused. */
export function staticCacheHeaders(
  defaults: string,
  manifest: Record<string, ManifestEntry>,
  emitted: ReadonlySet<string>,
): string {
  const candidates = new Set(
    Object.values(manifest).flatMap((entry) => [entry.file, ...(entry.css ?? [])]),
  );
  const paths = [...candidates]
    .filter(
      (path): path is string =>
        !!path && emitted.has(path) && /^assets\/[^/\s?#]+-[\w-]{8,}\.(?:js|css)$/.test(path),
    )
    .sort();
  // Detach inherited directives before attaching the exact asset's private policy.
  // Public defaults still protect HTML, unknown assets and every error response.
  const protectedDefaults = defaults.replace(
    /^\/\*\r?\n/,
    "/*\n  Cache-Control: no-store\n  Pragma: no-cache\n",
  );
  return `${protectedDefaults.trimEnd()}\n${paths
    .map(
      (path) =>
        `\n/${path}\n  ! Cache-Control\n  ! Pragma\n  Cache-Control: private, max-age=31536000, immutable\n`,
    )
    .join("")}`;
}

export function staticCache(): Plugin {
  let root: string;
  return {
    name: "kiroku-static-cache",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      root = config.root;
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        if (this.environment.name !== "client") return;
        const manifest = bundle[".vite/manifest.json"];
        if (manifest?.type !== "asset") return;
        const source =
          typeof manifest.source === "string"
            ? manifest.source
            : new TextDecoder().decode(manifest.source);
        this.emitFile({
          type: "asset",
          fileName: "_headers",
          source: staticCacheHeaders(
            readFileSync(resolve(root, "public/_headers"), "utf8"),
            JSON.parse(source) as Record<string, ManifestEntry>,
            new Set(Object.keys(bundle)),
          ),
        });
      },
    },
  };
}
