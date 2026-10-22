import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { readFile, rename, rm, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import {
  DEBUG_PORT,
  ensureDir,
  info,
  isAlive,
  isPortOpen,
  pathExists,
  readJson,
  readTail,
  sleep,
  stamp,
  toolArtifactKey,
  waitForPort,
  writeJson,
} from "./common.mjs";
import { ensureArtifact } from "./download.mjs";
import { loadProject, resolveProjectRoot } from "./project.mjs";

function stateDir(root) {
  return path.join(root, ".clx-dev");
}

function stateFile(root) {
  return path.join(stateDir(root), "run.json");
}

function splitLogLines(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

async function connect() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: DEBUG_PORT });
    socket.setTimeout(3000);
    socket.once("connect", () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`timed out connecting to 127.0.0.1:${DEBUG_PORT}`));
    });
    socket.once("error", (err) => reject(err));
  });
}

function sendAndRead(socket, command, timeoutMs = 10000) {
  const marker = `<-<${command.split(/\s+/)[0]}`;
  return new Promise((resolve, reject) => {
    let data = "";
    let idleTimer = null;
    const totalTimer = setTimeout(() => finish(), timeoutMs);

    const cleanup = () => {
      clearTimeout(totalTimer);
      if (idleTimer) clearTimeout(idleTimer);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const finish = (err) => {
      cleanup();
      if (err) reject(err);
      else resolve(data);
    };
    const onData = (chunk) => {
      data += chunk;
      if (data.includes(marker)) {
        setTimeout(() => finish(), 80);
        return;
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(), 600);
    };
    const onError = (err) => finish(err);

    socket.on("data", onData);
    socket.once("error", onError);
    socket.write(`${command}\n`);
  });
}

async function withConnection(callback) {
  const socket = await connect();
  socket.setEncoding("utf8");
  try {
    return await callback(socket);
  } finally {
    socket.destroy();
  }
}

async function ensureRunning({ wait = false } = {}) {
  if (await isPortOpen(DEBUG_PORT)) return;
  if (wait) {
    if (await waitForPort(DEBUG_PORT, 20000)) return;
    throw new Error(`simulator did not open port ${DEBUG_PORT} within 20s`);
  }
  throw new Error('simulator is not running; run "run" first (or pass --wait)');
}

export async function runSimulator(flags) {
  const root = await resolveProjectRoot(flags);
  const project = await loadProject(root);

  if (!(await pathExists(project.entryAbs))) {
    throw new Error(`entry file not found: ${project.entry}`);
  }

  if (await isPortOpen(DEBUG_PORT)) {
    throw new Error(
      `port ${DEBUG_PORT} is already in use; another simulator is running. Run "stop" for this project or close it first`,
    );
  }

  const toolKey = toolArtifactKey();
  if (!toolKey) throw new Error(`unsupported platform: ${process.platform}`);
  const executable = await ensureArtifact(toolKey);

  const dir = stateDir(root);
  await ensureDir(dir);
  const log = path.join(dir, "run.log");
  const workspace = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  const fd = openSync(log, "w");
  const child = spawn(executable, ["-d", workspace, "-r", project.entry], {
    cwd: root,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  child.on("error", () => {
    // The pid check below reports the failure; this prevents an unhandled event.
  });
  closeSync(fd);
  child.unref();

  if (!child.pid) {
    throw new Error(`failed to start ${executable}`);
  }

  const state = {
    pid: child.pid,
    entry: project.entry,
    spec: project.spec,
    startedAt: new Date().toISOString(),
    log,
  };
  await writeJson(stateFile(root), state);

  const deadline = Date.now() + 20000;
  let open = false;
  while (Date.now() < deadline) {
    if (await isPortOpen(DEBUG_PORT)) {
      open = true;
      break;
    }
    if (child.exitCode !== null) break;
    await sleep(300);
  }

  if (!open) {
    const tail = await readTail(log, 15);
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // already gone
    }
    await rm(stateFile(root), { force: true });
    await rm(path.join(root, `${project.entry}.rom`), { force: true });
    throw new Error(
      `simulator did not open port ${DEBUG_PORT}. Log: ${log}\n${tail || "(empty log)"}`,
    );
  }

  return { pid: child.pid, port: DEBUG_PORT, log, project };
}

export async function stopSimulator(flags) {
  const root = await resolveProjectRoot(flags);
  const file = stateFile(root);
  const state = await readJson(file, null);
  if (!state || !state.pid) {
    info("simulator is not running (no run state)");
    return { stopped: false };
  }

  const pid = state.pid;
  if (isAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (!isAlive(pid) && !(await isPortOpen(DEBUG_PORT))) break;
      await sleep(200);
    }
    if (isAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }

  await rm(file, { force: true });
  if (state.entry) {
    await rm(path.join(root, `${state.entry}.rom`), { force: true });
  }
  return { stopped: true, pid };
}

export async function simulatorStatus(flags) {
  const root = await resolveProjectRoot(flags);
  const state = await readJson(stateFile(root), null);
  const portOpen = await isPortOpen(DEBUG_PORT);
  const pidAlive = Boolean(state && isAlive(state.pid));
  return {
    root,
    running: pidAlive || portOpen,
    pid: state?.pid || null,
    pidAlive,
    port: DEBUG_PORT,
    portOpen,
    entry: state?.entry || null,
    startedAt: state?.startedAt || null,
    log: state?.log || null,
  };
}

export async function readSimulatorLog(flags = {}) {
  const root = await resolveProjectRoot(flags);
  const state = await readJson(stateFile(root), null);
  const log = state?.log ? path.resolve(root, state.log) : path.join(stateDir(root), "run.log");

  let text;
  try {
    text = await readFile(log, "utf8");
  } catch {
    throw new Error(`no simulator log at ${log}; run the simulator first`);
  }

  let lines = splitLogLines(text);

  if (flags.grep) {
    let pattern;
    try {
      pattern = new RegExp(String(flags.grep), "i");
    } catch (err) {
      throw new Error(`invalid --grep pattern: ${err.message}`);
    }
    lines = lines.filter((line) => pattern.test(line));
  }

  if (!flags.all) {
    const tail = flags.tail === undefined ? 80 : Number(flags.tail);
    if (!Number.isInteger(tail) || tail < 1) {
      throw new Error("--tail must be a positive integer");
    }
    lines = lines.slice(-tail);
  }

  return { root, log, lines };
}

export async function runProbe(flags = {}) {
  const until = flags.until === undefined ? "probe: done" : String(flags.until);
  const timeoutSeconds = flags.timeout === undefined ? 20 : Number(flags.timeout);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error("--timeout must be a positive number of seconds");
  }
  const tail = flags.tail === undefined ? null : Number(flags.tail);
  if (tail !== null && (!Number.isInteger(tail) || tail < 1)) {
    throw new Error("--tail must be a positive integer");
  }
  const keep = Boolean(flags.keep);

  const started = await runSimulator(flags);
  const root = started.project.root;
  const startedAt = Date.now();
  const deadline = startedAt + timeoutSeconds * 1000;
  let matched = false;
  let matchedAt = null;
  let dead = false;

  try {
    while (Date.now() < deadline) {
      const text = await readFile(started.log, "utf8").catch(() => "");
      if (!until || text.includes(until)) {
        matched = true;
        matchedAt = Date.now();
        break;
      }
      if (!isAlive(started.pid)) {
        dead = true;
        break;
      }
      await sleep(150);
    }
    if (matched) await sleep(200);
  } finally {
    if (!keep) await stopSimulator({ root });
  }

  const text = await readFile(started.log, "utf8").catch(() => "");
  let lines = splitLogLines(text);
  if (tail !== null) lines = lines.slice(-tail);

  return {
    root,
    log: started.log,
    pid: started.pid,
    until,
    timeoutSeconds,
    matched,
    dead,
    timedOut: !matched && !dead,
    kept: keep,
    elapsedMs: Date.now() - startedAt,
    matchedMs: matchedAt === null ? null : matchedAt - startedAt,
    lines,
  };
}

async function readBatchCommands(source, root) {
  let text;
  if (source === "-") {
    process.stdin.setEncoding("utf8");
    text = "";
    for await (const chunk of process.stdin) text += chunk;
  } else {
    const file = path.isAbsolute(source) ? source : path.resolve(root, source);
    try {
      text = await readFile(file, "utf8");
    } catch (err) {
      throw new Error(`cannot read batch file ${file}: ${err.message}`);
    }
  }

  const commands = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (commands.length === 0) {
    throw new Error(`no debug commands in ${source === "-" ? "stdin" : source}`);
  }
  return commands;
}

export async function debugSession(flags) {
  const root = await resolveProjectRoot(flags);
  const wait = Boolean(flags.wait);
  const command = flags.cmd ? String(flags.cmd) : null;
  const batch = flags.batch ? String(flags.batch) : null;
  if (command && batch) throw new Error("use either --cmd or --batch, not both");
  const batchCommands = batch ? await readBatchCommands(batch, root) : null;

  await ensureRunning({ wait });

  const vm = flags.vm ? String(flags.vm) : null;

  if (batch) {
    return withConnection(async (socket) => {
      if (vm) await sendAndRead(socket, `vm ${vm}`);
      const responses = [];
      for (const item of batchCommands) {
        if (item === "exit" || item === "quit") break;
        try {
          const response = await sendAndRead(socket, item);
          responses.push({ command: item, response });
        } catch (err) {
          throw new Error(`batch command ${responses.length + 1} failed (${item}): ${err.message}`);
        }
      }
      return { responses, command: null };
    });
  }

  if (command) {
    return withConnection(async (socket) => {
      if (vm) await sendAndRead(socket, `vm ${vm}`);
      const response = await sendAndRead(socket, command);
      return { response, command };
    });
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      "no --cmd or --batch given and stdin is not a TTY; pass --cmd or --batch for non-interactive use",
    );
  }

  const socket = await connect();
  socket.setEncoding("utf8");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "clx> ",
    historySize: 200,
  });

  const close = () => {
    rl.close();
    socket.destroy();
  };

  if (vm) await sendAndRead(socket, `vm ${vm}`);

  console.log(`connected to 127.0.0.1:${DEBUG_PORT}; type "help" for commands, "exit" to quit`);
  rl.prompt();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === "exit" || trimmed === "quit") break;
    if (trimmed) {
      try {
        const response = await sendAndRead(socket, trimmed);
        process.stdout.write(response);
        if (!response.endsWith("\n")) process.stdout.write("\n");
      } catch (err) {
        console.error(`error: ${err.message}`);
      }
    }
    rl.prompt();
  }
  close();
  return { response: "", command: null };
}

export async function takeShot(flags) {
  const root = await resolveProjectRoot(flags);
  await ensureRunning({ wait: Boolean(flags.wait) });

  const relative = path.posix.join(".clx-dev", `shot-${stamp()}.bmp`);
  const captured = path.join(root, ...relative.split("/"));
  await ensureDir(path.dirname(captured));

  const response = await withConnection((socket) => sendAndRead(socket, `shot ${relative}`));
  const md5 = response.match(/md5=([0-9a-f]{32})/i)?.[1] || null;
  if (!md5) throw new Error(`shot failed: ${response.trim() || "empty response"}`);

  const output = flags.out ? path.resolve(process.cwd(), String(flags.out)) : captured;
  if (path.resolve(output) !== path.resolve(captured)) {
    await ensureDir(path.dirname(output));
    await rm(output, { force: true });
    await rename(captured, output);
  }
  const size = await stat(output).then((value) => value.size).catch(() => 0);
  if (size === 0) throw new Error(`shot did not create ${output}`);

  if (flags.expect) {
    const expected = String(flags.expect).toLowerCase();
    const matched = Boolean(md5) && expected === md5.toLowerCase();
    return { path: output, md5, size, matched, expected };
  }
  return { path: output, md5, size, matched: true, expected: null };
}
