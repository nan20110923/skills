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
  artifactPath,
  artifactSize,
  ensureArtifact,
  installedArtifact,
  loadManifest,
} from "./download.mjs";
import { proxyFor } from "./proxy.mjs";
import { projectDocsLang } from "./project.mjs";

function rosettaStatus() {
  if (!IS_MAC || process.arch !== "arm64") return null;
  const result = spawnSync("arch", ["-x86_64", "/usr/bin/true"], { encoding: "utf8" });
  return result.status === 0;
}

export async function doctor(flags) {
  const toolKey = toolArtifactKey();
  const lang = resolveDocsLang(flags.lang, await projectDocsLang());
  const docsKey = `docs:${lang}`;
  const required = toolKey ? [toolKey, "examples"] : ["examples"];

  // A docs bundle is per language and only needed once the user works in that
  // language, so "doctor --refresh" must not pre-download one from the locale.
  const docsInstalled = await installedArtifact(docsKey);
  const docsCached = Boolean(docsInstalled);
  const keys = docsCached || flags.lang ? [...required, docsKey] : required;
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
    if (!installed && required.includes(key)) missing += 1;
  }

  const proxy = proxyFor(ARTIFACTS[toolKey || "examples"].url);
  const result = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cache: cacheRoot(),
    docsLang: lang,
    docs: {
      lang,
      key: docsKey,
      cached: docsCached,
      path: docsCached ? artifactPath(docsKey) : null,
    },
    proxy: proxy ? { url: proxy.url, source: proxy.source } : null,
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
  console.log(`proxy:    ${proxy ? `${proxy.url} (${proxy.source})` : "none, downloading directly"}`);
  console.log(`docs:     ${lang} ${docsCached ? "cached" : "not cached, init and docs download it on first use"}`);
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
