import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  ARTIFACTS,
  DEBUG_PORT,
  IS_MAC,
  cacheRoot,
  formatBytes,
  isPortOpen,
  resolveDocsLang,
  toolArtifactKey,
} from "./common.mjs";
import {
  artifactSize,
  ensureArtifact,
  installedArtifact,
  loadManifest,
} from "./download.mjs";

function rosettaStatus() {
  if (!IS_MAC || process.arch !== "arm64") return null;
  const result = spawnSync("arch", ["-x86_64", "/usr/bin/true"], { encoding: "utf8" });
  return result.status === 0;
}

export async function doctor(flags) {
  const toolKey = toolArtifactKey();
  const lang = resolveDocsLang(flags.lang);
  const keys = toolKey ? [toolKey, "examples", `docs:${lang}`] : ["examples", `docs:${lang}`];
  const artifacts = {};
  let missing = 0;

  for (const key of keys) {
    let refreshError = null;
    if (flags.refresh && !flags.offline) {
      try {
        await ensureArtifact(key, { refresh: true, silent: Boolean(flags.json) });
      } catch (err) {
        refreshError = err.message;
      }
    }

    const installed = await installedArtifact(key);
    const entry = (await loadManifest()).artifacts[key] || null;
    artifacts[key] = {
      installed: Boolean(installed),
      path: installed,
      bytes: installed ? await artifactSize(key) : 0,
      url: ARTIFACTS[key]?.url || null,
      fetchedAt: entry?.fetchedAt || null,
      etag: entry?.etag || null,
      error: refreshError,
    };
    if (!installed) missing += 1;
  }

  const result = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cache: cacheRoot(),
    docsLang: lang,
    artifacts,
    rosetta: rosettaStatus(),
    debugPort: DEBUG_PORT,
    debugPortOpen: await isPortOpen(DEBUG_PORT),
    ok: Boolean(toolKey) && missing === 0,
  };

  if (flags.json) return result;

  console.log(`platform: ${result.platform} ${result.arch}`);
  console.log(`node:     ${result.node}`);
  console.log(`cache:    ${result.cache}`);
  console.log(`docs:     ${result.docsLang}`);
  console.log("");
  for (const [key, value] of Object.entries(artifacts)) {
    const status = value.installed ? "ok" : "missing";
    const detail = value.installed
      ? `${value.path} (${formatBytes(value.bytes)})`
      : value.error || "run doctor --refresh";
    console.log(`${key.padEnd(14)} ${status.padEnd(8)} ${detail}`);
    if (value.installed && value.error) {
      console.log(`${"".padEnd(14)} refresh failed: ${value.error}`);
    }
  }
  console.log("");
  if (result.rosetta === null) {
    console.log("rosetta:  not required on this machine");
  } else {
    console.log(`rosetta:  ${result.rosetta ? "ok" : "missing"} (the macOS build is x86_64)`);
  }
  console.log(`debug:    127.0.0.1:${DEBUG_PORT} ${result.debugPortOpen ? "open" : "closed"}`);

  return result;
}
