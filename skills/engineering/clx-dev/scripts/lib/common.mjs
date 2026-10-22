import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const SKILL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const IS_MAC = process.platform === "darwin";
export const IS_WIN = process.platform === "win32";

export const BASE_URL = "https://x.cololight.com/mweb/docs/downloads/";
export const DEBUG_PORT = 3563;
export const DEFAULT_SPEC = "coloX-16";

export const ARTIFACTS = {
  "tool:macos": {
    url: `${BASE_URL}coloXtool_macos.zip`,
    dir: "tools/macos",
    kind: "tool",
  },
  "tool:win32": {
    url: `${BASE_URL}coloXtool_win32.zip`,
    dir: "tools/win32",
    kind: "tool",
  },
  "docs:zh-CN": {
    url: `${BASE_URL}colox-docs-zh-CN.zip`,
    dir: "docs/zh-CN",
    check: "guide/README.md",
  },
  "docs:en": {
    url: `${BASE_URL}colox-docs-en.zip`,
    dir: "docs/en",
    check: "guide/README.md",
  },
  examples: {
    url: `${BASE_URL}colox-examples.zip`,
    dir: "examples",
    check: "guide/examples/README.md",
  },
};

const BOOLEAN_FLAGS = new Set([
  "here",
  "merge",
  "no-git",
  "no-docs",
  "offline",
  "json",
  "refresh",
  "wait",
  "help",
  "reuse",
  "foreground",
  "release",
  "all",
  "keep",
]);

export function cacheRoot() {
  if (process.env.CLX_DEV_HOME) return path.resolve(process.env.CLX_DEV_HOME);
  return path.join(os.homedir(), ".cache", "clx-dev");
}

export function toolArtifactKey() {
  if (IS_MAC) return "tool:macos";
  if (IS_WIN) return "tool:win32";
  return null;
}

export function parseArgs(argv) {
  const positionals = [];
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
      if (eq !== -1) {
        flags[name] = token.slice(eq + 1);
        continue;
      }
      if (BOOLEAN_FLAGS.has(name)) {
        flags[name] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith("-") && next !== "-")) {
        flags[name] = true;
      } else {
        flags[name] = next;
        i += 1;
      }
      continue;
    }
    positionals.push(token);
  }

  return { positionals, flags };
}

export function die(message, code = 1) {
  console.error(`error: ${message}`);
  process.exit(code);
}

export function info(message = "") {
  console.log(message);
}

export function warn(message) {
  console.error(`warning: ${message}`);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "?";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function runCommand(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

export async function readTail(file, lines = 20) {
  try {
    const text = await readFile(file, "utf8");
    return text.trimEnd().split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

export async function findExecutable(root, names) {
  const queue = [[root, 0]];
  while (queue.length > 0) {
    const [dir, depth] = queue.shift();
    if (depth > 8) continue;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push([full, depth + 1]);
      } else if (entry.isFile() && names.includes(entry.name)) {
        return full;
      }
    }
  }
  return null;
}

export async function makeExecutable(file) {
  if (IS_WIN) return;
  await chmod(file, 0o755);
}

export function assertSafeRomName(name) {
  if (!name || name === "." || name === "..") {
    throw new Error("ROM name must not be empty, '.' or '..'");
  }
  if (/[\\/\0]/.test(name)) {
    throw new Error(`ROM name must not contain a path separator: ${name}`);
  }
  if (name.startsWith("-")) {
    throw new Error(`ROM name must not start with '-': ${name}`);
  }
}

export function normalizeDocsLang(value) {
  const raw = String(value || "").toLowerCase();
  if (raw === "zh" || raw === "zh-cn" || raw === "zh_cn" || raw.startsWith("zh-") || raw.startsWith("zh_")) {
    return "zh-CN";
  }
  if (raw === "en" || raw.startsWith("en-") || raw.startsWith("en_")) return "en";
  return null;
}

export function resolveDocsLang(flag, hint) {
  return (
    normalizeDocsLang(flag) ||
    normalizeDocsLang(process.env.CLX_DOCS_LANG) ||
    normalizeDocsLang(hint) ||
    normalizeDocsLang(process.env.LC_ALL) ||
    normalizeDocsLang(process.env.LC_MESSAGES) ||
    normalizeDocsLang(process.env.LANG) ||
    "en"
  );
}

export function isPortOpen(port = DEBUG_PORT, host = "127.0.0.1", timeout = 600) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function waitForPort(port = DEBUG_PORT, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isPortOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
