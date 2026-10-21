import { spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import process from "node:process";
import tls from "node:tls";
import { IS_MAC, IS_WIN } from "./common.mjs";

const DIRECT_VALUES = new Set(["", "0", "false", "no", "none", "off", "direct"]);
const HTTP_PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy"];
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const HANDSHAKE_TIMEOUT = 20000;

function parseProxy(value) {
  const raw = String(value ?? "").trim();
  if (DIRECT_VALUES.has(raw.toLowerCase())) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const protocol = url.protocol.toLowerCase();
  if (!["http:", "https:", "socks:", "socks5:", "socks5h:"].includes(protocol)) return null;
  if (!url.hostname) return null;
  return url;
}

function proxyLabel(url) {
  const auth = url.username ? `${url.username}:***@` : "";
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${auth}${url.hostname}${port}`;
}

function noProxyPatterns() {
  const value = process.env.CLX_NO_PROXY ?? process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  return String(value)
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function bypassesProxy(host) {
  const bare = String(host || "").toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!bare) return false;
  for (const entry of noProxyPatterns()) {
    if (entry === "*") return true;
    if (entry === "<local>") {
      if (!bare.includes(".") || bare === "localhost" || bare.endsWith(".local")) return true;
      continue;
    }
    const pattern = entry.split("/")[0].split(":")[0].replace(/^\*?\./, "");
    if (!pattern) continue;
    if (bare === pattern || bare.endsWith(`.${pattern}`)) return true;
  }
  return false;
}

let cachedSystemProxy;

function macSystemProxy() {
  const result = spawnSync("scutil", ["--proxy"], { encoding: "utf8", timeout: 5000 });
  if (result.status !== 0 || !result.stdout) return null;
  const read = (key) => {
    const match = result.stdout.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "m"));
    return match ? match[1].trim() : "";
  };
  const candidates = [
    ["HTTP", "HTTPSEnable", "HTTPSProxy", "HTTPSPort"],
    ["HTTP", "HTTPEnable", "HTTPProxy", "HTTPPort"],
    ["SOCKS", "SOCKSEnable", "SOCKSProxy", "SOCKSPort"],
  ];
  for (const [kind, flag, hostKey, portKey] of candidates) {
    if (read(flag) !== "1") continue;
    const host = read(hostKey);
    const port = read(portKey);
    if (!host) continue;
    if (host === "0.0.0.0" || host === "::") continue;
    const scheme = kind === "SOCKS" ? "socks5h" : "http";
    return `${scheme}://${host}${port ? `:${port}` : ""}`;
  }
  return null;
}

function windowsSystemProxy() {
  const result = spawnSync(
    "reg",
    ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
    { encoding: "utf8", timeout: 5000 },
  );
  if (result.status !== 0 || !result.stdout) return null;
  const read = (name) => {
    const match = result.stdout.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, "m"));
    return match ? match[1].trim() : "";
  };
  if (read("ProxyEnable") !== "0x1") return null;
  const server = read("ProxyServer");
  if (!server) return null;
  const entries = server.split(";").map((entry) => entry.trim()).filter(Boolean);
  const selected =
    entries.find((entry) => /^https=/i.test(entry)) ||
    entries.find((entry) => /^http=/i.test(entry)) ||
    entries.find((entry) => !entry.includes("="));
  if (!selected) return null;
  const value = selected.includes("=") ? selected.slice(selected.indexOf("=") + 1) : selected;
  if (!value) return null;
  return value.includes("://") ? value : `http://${value}`;
}

function systemProxyUrl() {
  if (cachedSystemProxy === undefined) {
    cachedSystemProxy = IS_MAC ? macSystemProxy() : IS_WIN ? windowsSystemProxy() : null;
  }
  return cachedSystemProxy;
}

function pickProxy(target) {
  if (bypassesProxy(target?.hostname)) return null;

  const explicit = process.env.CLX_PROXY;
  if (explicit !== undefined && String(explicit).trim() !== "") {
    const parsed = parseProxy(explicit);
    return parsed ? { url: parsed, source: "CLX_PROXY" } : null;
  }

  for (const name of HTTP_PROXY_VARS) {
    const value = process.env[name];
    if (!value) continue;
    const parsed = parseProxy(value);
    if (parsed) return { url: parsed, source: "environment" };
    if (DIRECT_VALUES.has(String(value).trim().toLowerCase())) return null;
  }

  const system = systemProxyUrl();
  const parsed = system ? parseProxy(system) : null;
  return parsed ? { url: parsed, source: "system" } : null;
}

export function proxyFor(target) {
  const picked = pickProxy(typeof target === "string" ? new URL(target) : target);
  return picked ? { url: proxyLabel(picked.url), source: picked.source } : null;
}

function defaultPort(protocol) {
  if (protocol === "https:") return 443;
  if (protocol.startsWith("socks")) return 1080;
  return 80;
}

function connect(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timed out connecting to ${host}:${port}`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.setNoDelay(true);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitFor(emitter, event, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.destroy?.();
      reject(new Error(message));
    }, timeoutMs);
    const onError = (err) => {
      clearTimeout(timer);
      reject(err);
    };
    emitter.once(event, () => {
      clearTimeout(timer);
      emitter.off("error", onError);
      resolve();
    });
    emitter.once("error", onError);
  });
}

function proxyAuthorization(proxy) {
  if (!proxy.username) return null;
  const user = decodeURIComponent(proxy.username);
  const pass = decodeURIComponent(proxy.password || "");
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function readHead(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const fail = (err) => {
      cleanup();
      socket.destroy();
      reject(err);
    };
    const onError = (err) => fail(err);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) {
        if (buffer.length > 64 * 1024) fail(new Error("proxy response headers are too large"));
        return;
      }
      const rest = buffer.subarray(end + 4);
      const head = buffer.subarray(0, end).toString("latin1");
      cleanup();
      if (rest.length > 0) socket.unshift(rest);
      resolve(head);
    };
    const timer = setTimeout(() => fail(new Error("proxy handshake timed out")), timeoutMs);
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

function createReader(socket) {
  let buffer = Buffer.alloc(0);
  let pending = null;
  let failure = null;

  const fail = (err) => {
    failure = failure || err;
    if (pending) {
      const { reject } = pending;
      pending = null;
      reject(failure);
    }
  };

  const flush = () => {
    if (!pending || buffer.length < pending.size) return;
    const chunk = buffer.subarray(0, pending.size);
    buffer = buffer.subarray(pending.size);
    const { resolve } = pending;
    pending = null;
    resolve(chunk);
  };

  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    flush();
  };

  socket.on("data", onData);
  socket.once("error", fail);
  socket.once("close", () => fail(new Error("proxy closed the connection during the handshake")));

  return {
    read(size) {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        pending = { size, resolve, reject };
        flush();
      });
    },
    close() {
      socket.off("data", onData);
    },
  };
}

async function socks5Handshake(socket, proxy, host, port, timeoutMs) {
  const reader = createReader(socket);
  const timer = setTimeout(() => {
    reader.close();
    socket.destroy();
  }, timeoutMs);

  try {
    const wantsAuth = Boolean(proxy.username);
    socket.write(Buffer.from(wantsAuth ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]));

    const [version, method] = await reader.read(2);
    if (version !== 0x05) throw new Error("the proxy did not answer as a SOCKS5 server");
    if (method === 0x02) {
      const user = Buffer.from(decodeURIComponent(proxy.username || ""), "utf8");
      const pass = Buffer.from(decodeURIComponent(proxy.password || ""), "utf8");
      socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
      const [, status] = await reader.read(2);
      if (status !== 0x00) throw new Error("the proxy rejected the SOCKS5 credentials");
    } else if (method !== 0x00) {
      throw new Error("the proxy requires a SOCKS5 authentication method that is not supported");
    }

    const name = Buffer.from(host, "utf8");
    const request = Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]),
      name,
      Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    ]);
    socket.write(request);

    const [replyVersion, reply, , atyp] = await reader.read(4);
    if (replyVersion !== 0x05 || reply !== 0x00) {
      throw new Error(`the SOCKS5 proxy refused ${host}:${port} (code ${reply})`);
    }
    if (atyp === 0x01) await reader.read(4);
    else if (atyp === 0x04) await reader.read(16);
    else if (atyp === 0x03) {
      const [length] = await reader.read(1);
      await reader.read(length);
    } else {
      throw new Error(`the SOCKS5 proxy sent an unknown address type: ${atyp}`);
    }
    await reader.read(2);
  } finally {
    clearTimeout(timer);
    reader.close();
  }
}

async function openTunnel(proxy, target, port, timeoutMs) {
  const proxyPort = Number(proxy.port) || defaultPort(proxy.protocol);
  let socket = await connect(proxy.hostname, proxyPort, timeoutMs);

  if (proxy.protocol === "https:") {
    const secure = tls.connect({
      socket,
      servername: net.isIP(proxy.hostname) ? undefined : proxy.hostname,
      ALPNProtocols: ["http/1.1"],
    });
    await waitFor(secure, "secureConnect", timeoutMs, `TLS handshake with the proxy ${proxy.hostname} timed out`);
    socket = secure;
  }

  if (proxy.protocol.startsWith("socks")) {
    await socks5Handshake(socket, proxy, target.hostname, port, timeoutMs);
  } else {
    const authority = `${target.hostname}:${port}`;
    const lines = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`, "Proxy-Connection: keep-alive"];
    const authorization = proxyAuthorization(proxy);
    if (authorization) lines.push(`Proxy-Authorization: ${authorization}`);
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    const head = await readHead(socket, timeoutMs);
    const statusLine = head.split(/\r?\n/, 1)[0];
    const status = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine);
    if (!status || Number(status[1]) !== 200) {
      socket.destroy();
      throw new Error(`the proxy refused CONNECT ${authority}: ${statusLine || "no status line"}`);
    }
  }

  if (target.protocol !== "https:") return socket;

  const secure = tls.connect({
    socket,
    servername: net.isIP(target.hostname) ? undefined : target.hostname,
    ALPNProtocols: ["http/1.1"],
  });
  await waitFor(secure, "secureConnect", timeoutMs, `TLS handshake with ${target.hostname} timed out`);
  return secure;
}

function fixedSocketAgent(socket, secure) {
  const Base = secure ? https.Agent : http.Agent;
  const agent = new Base({ keepAlive: false });
  agent.createConnection = () => socket;
  return agent;
}

function issue(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`no data for ${Math.round(timeoutMs / 1000)}s`));
    });
    req.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    req.once("response", (res) => {
      settled = true;
      res.setTimeout(timeoutMs, () => res.destroy(new Error(`no data for ${Math.round(timeoutMs / 1000)}s`)));
      resolve({ status: res.statusCode, headers: res.headers, stream: res });
    });
    req.end();
  });
}

async function send(target, { method, headers, timeoutMs }) {
  const secure = target.protocol === "https:";
  const port = Number(target.port) || defaultPort(target.protocol);
  const requestPath = `${target.pathname}${target.search}`;
  const picked = pickProxy(target);

  if (!picked) {
    const transport = secure ? https : http;
    return issue(
      transport.request({
        host: target.hostname,
        port,
        path: requestPath,
        method,
        headers,
        agent: false,
      }),
      timeoutMs,
    );
  }

  const proxy = picked.url;

  if (!secure && (proxy.protocol === "http:" || proxy.protocol === "https:")) {
    const transport = proxy.protocol === "https:" ? https : http;
    const authorization = proxyAuthorization(proxy);
    const proxied = { ...headers, host: target.host };
    if (authorization) proxied["proxy-authorization"] = authorization;
    return issue(
      transport.request({
        host: proxy.hostname,
        port: Number(proxy.port) || defaultPort(proxy.protocol),
        path: target.toString(),
        method,
        headers: proxied,
        agent: false,
      }),
      timeoutMs,
    );
  }

  const socket = await openTunnel(proxy, target, port, Math.min(timeoutMs, HANDSHAKE_TIMEOUT));
  socket.on("error", () => {});
  const transport = secure ? https : http;
  const req = transport.request({
    host: target.hostname,
    port,
    path: requestPath,
    method,
    headers,
    agent: fixedSocketAgent(socket, secure),
  });
  req.once("close", () => socket.destroy());
  return issue(req, timeoutMs);
}

export async function httpRequest(url, { method = "GET", headers = {}, timeoutMs = 120000, redirects = MAX_REDIRECTS } = {}) {
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`unsupported protocol: ${target.protocol}`);
  }

  const { status, headers: responseHeaders, stream } = await send(target, { method, headers, timeoutMs });
  const location = responseHeaders.location;

  if (REDIRECT_CODES.has(status) && location && redirects > 0) {
    stream.resume();
    stream.destroy();
    return httpRequest(new URL(location, target).toString(), { method, headers, timeoutMs, redirects: redirects - 1 });
  }

  const normalized = new Headers();
  for (const [name, value] of Object.entries(responseHeaders)) {
    if (Array.isArray(value)) for (const item of value) normalized.append(name, item);
    else if (value !== undefined) normalized.set(name, value);
  }

  return {
    status,
    ok: status >= 200 && status < 300,
    headers: normalized,
    stream,
  };
}
