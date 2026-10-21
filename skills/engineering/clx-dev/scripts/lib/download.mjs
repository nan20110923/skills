import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import process from "node:process";
import {
  ARTIFACTS,
  IS_WIN,
  cacheRoot,
  ensureDir,
  findExecutable,
  makeExecutable,
  readJson,
  sha256File,
  writeJson,
} from "./common.mjs";

const USER_AGENT = "clx-dev/0.1 (+https://github.com/nan20110923/skills)";

export function manifestPath() {
  return path.join(cacheRoot(), "manifest.json");
}

export function artifactPath(key) {
  const spec = ARTIFACTS[key];
  if (!spec) throw new Error(`unknown artifact: ${key}`);
  return path.join(cacheRoot(), spec.dir);
}

export async function loadManifest() {
  return (await readJson(manifestPath(), null)) || { version: 1, artifacts: {} };
}

export async function saveManifest(manifest) {
  await writeJson(manifestPath(), manifest);
}

async function verifyArtifact(key, dir) {
  const spec = ARTIFACTS[key];
  if (spec.kind === "tool") {
    const names = IS_WIN ? ["coloXtool.exe"] : ["coloXtool"];
    const executable = await findExecutable(dir, names);
    if (!executable) throw new Error(`no coloXtool executable found in ${dir}`);
    await makeExecutable(executable);
    return executable;
  }
  const marker = path.join(dir, spec.check);
  const exists = await stat(marker).then(() => true).catch(() => false);
  if (!exists) throw new Error(`artifact is missing ${spec.check}`);
  return dir;
}

export async function installedArtifact(key) {
  const dir = artifactPath(key);
  try {
    return await verifyArtifact(key, dir);
  } catch {
    return null;
  }
}

async function downloadTo(url, dest) {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(600000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  if (!response.body) throw new Error(`empty response for ${url}`);

  await ensureDir(path.dirname(dest));
  const partial = `${dest}.part`;
  await rm(partial, { force: true });
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    await rm(dest, { force: true });
    await rename(partial, dest);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }

  return {
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    bytes: (await stat(dest)).size,
  };
}

async function head(url) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: { "user-agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return null;
    return {
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  } catch {
    return null;
  }
}

function extractZip(zip, dest) {
  const unzip = spawnSync("unzip", ["-q", "-o", zip, "-d", dest], { encoding: "utf8" });
  if (unzip.status === 0) return;
  const tar = spawnSync("tar", ["-xf", zip, "-C", dest], { encoding: "utf8" });
  if (tar.status === 0) return;
  const quote = (value) => value.replace(/'/g, "''");
  const powershell = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${quote(zip)}' -DestinationPath '${quote(dest)}' -Force`,
    ],
    { encoding: "utf8" },
  );
  if (powershell.status === 0) return;
  throw new Error(`failed to extract ${path.basename(zip)} (tried unzip, tar, and PowerShell)`);
}

async function install(key, { silent = false } = {}) {
  const spec = ARTIFACTS[key];
  if (!spec) throw new Error(`unknown artifact: ${key}`);

  const root = cacheRoot();
  const downloadDir = path.join(root, "downloads");
  const zip = path.join(downloadDir, `${key.replace(/[:/]/g, "-")}.zip`);
  const dest = artifactPath(key);
  const temp = `${dest}.tmp-${process.pid}`;

  if (!silent) console.log(`downloading ${spec.url}`);
  const meta = await downloadTo(spec.url, zip);
  const digest = await sha256File(zip);

  try {
    await rm(temp, { recursive: true, force: true });
    await ensureDir(temp);
    extractZip(zip, temp);
    await verifyArtifact(key, temp);

    await rm(dest, { recursive: true, force: true });
    await ensureDir(path.dirname(dest));
    await rename(temp, dest);
  } catch (err) {
    await rm(temp, { recursive: true, force: true });
    await rm(zip, { force: true });
    throw err;
  }
  await rm(zip, { force: true });

  const manifest = await loadManifest();
  manifest.artifacts[key] = {
    url: spec.url,
    path: spec.dir,
    sha256: digest,
    bytes: meta.bytes,
    etag: meta.etag,
    lastModified: meta.lastModified,
    fetchedAt: new Date().toISOString(),
  };
  await saveManifest(manifest);

  if (!silent) console.log(`installed ${key} (${(meta.bytes / 1024 / 1024).toFixed(1)} MB)`);
  return verifyArtifact(key, dest);
}

export async function ensureArtifact(key, { refresh = false, offline = false, silent = false } = {}) {
  const current = await installedArtifact(key);

  if (offline) {
    if (current) return current;
    throw new Error(
      `${key} is not cached and --offline was set; run "doctor --refresh" once with network access`,
    );
  }

  if (current && !refresh) return current;

  if (current && refresh) {
    const spec = ARTIFACTS[key];
    const remote = await head(spec.url);
    if (!remote) {
      if (!silent) console.log(`${key}: cannot check the remote copy; keeping the cached one`);
      return current;
    }
    const manifest = await loadManifest();
    const local = manifest.artifacts[key];
    const sameEtag = Boolean(remote.etag && local?.etag && remote.etag === local.etag);
    const sameTime = Boolean(
      remote.lastModified && local?.lastModified && remote.lastModified === local.lastModified,
    );
    const unchanged = sameEtag || (!remote.etag && sameTime);
    if (local && unchanged) {
      if (!silent) console.log(`${key} is up to date`);
      return current;
    }
  }

  return install(key, { silent });
}

export async function refreshArtifact(key) {
  return ensureArtifact(key, { refresh: true });
}

export async function artifactSize(key) {
  const dir = artifactPath(key);
  return dirSize(dir);
}

async function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      total += (await stat(full).catch(() => ({ size: 0 }))).size;
    }
  }
  return total;
}
