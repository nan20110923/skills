#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import {
  DEBUG_PORT,
  SKILL_ROOT,
  die,
  formatBytes,
  parseArgs,
} from "./lib/common.mjs";
import { buildProject, initProject } from "./lib/project.mjs";
import {
  debugSession,
  runSimulator,
  simulatorStatus,
  stopSimulator,
  takeShot,
} from "./lib/simulator.mjs";
import { doctor } from "./lib/doctor.mjs";
import { readDocsIndex, searchDocs } from "./lib/docs.mjs";

const VERSION = "0.1.0";

const VALUE_FLAGS = ["rom", "spec", "author", "lang", "root", "out", "cmd", "vm", "expect"];

const HELP = `clx-dev ${VERSION}

Usage:
  node scripts/clx.mjs <command> [options]

Commands:
  doctor                 Check the toolchain, docs, examples, and debug port
  init [name]            Scaffold a coloX cartridge project
  build                  Build a .rom from the configured entry cartridge
  run                    Start the simulator in the background
  stop                   Stop the simulator started by "run"
  status                 Show simulator process and port status
  debug                  Send a command to the 3563 debug channel, or open a REPL
  shot                   Capture a screenshot and print its pixel md5
  docs [query]           Search the cached coloX documentation

Common options:
  --root <dir>           Project root (default: walk up from the current directory)
  --lang zh|en           Documentation language for doctor/docs/init
  --json                 Machine-readable output (doctor, status)

init options:
  --here                 Use the current directory instead of creating one
  --rom <name>           Entry name; defaults to the project directory name
  --spec <spec>          Target spec (default: coloX-16)
  --author <name>        Author written into the cartridge header
  --merge                Add missing files to a non-empty directory
  --no-git               Do not run git init
  --no-docs              Do not download the documentation bundle
  --offline              Use only the local cache

build options:
  --out <file>           Output ROM path (default: dist/<rom>.rom)

debug options:
  --cmd <command>        Run one debug command and exit
  --vm <index>           Select a VM before running the command
  --wait                 Wait up to 20s for the simulator to open the port

shot options:
  --out <file>           Screenshot path (default: .clx-dev/shot-<time>.bmp)
  --expect <md5>         Exit non-zero when the pixel md5 differs

Environment:
  CLX_DEV_HOME           Cache directory (default: ~/.cache/clx-dev)
  CLX_PROXY              Proxy URL; "none" forces a direct connection
  CLX_NO_PROXY           Hosts that bypass the proxy
  CLX_DOCS_LANG          Default documentation language

Examples:
  node scripts/clx.mjs init mygame
  node scripts/clx.mjs init --here --rom mygame
  node scripts/clx.mjs build
  node scripts/clx.mjs run
  node scripts/clx.mjs debug --cmd "vmlist"
  node scripts/clx.mjs shot --expect 5f2a...
  node scripts/clx.mjs stop
`;

function printHelp() {
  process.stdout.write(HELP);
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));

  for (const name of VALUE_FLAGS) {
    if (flags[name] === true) die(`--${name} requires a value`);
  }

  if (flags.help || positionals.length === 0) {
    printHelp();
    return;
  }

  const command = positionals.shift();

  switch (command) {
    case "doctor": {
      const result = await doctor(flags);
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      if (!result.ok) die("required artifacts are missing; run doctor --refresh", 1);
      return;
    }

    case "init": {
      if (positionals.length > 1) die("init accepts at most one project name");
      const result = await initProject(positionals, flags);
      const skipped = result.written.filter((item) => item.skipped).map((item) => item.dest);

      console.log(`project:  ${result.target}`);
      console.log(`rom:      ${result.rom}`);
      console.log(`entry:    ${result.entry}`);
      console.log(`spec:     ${result.spec}`);
      console.log(`docs:     ${result.lang}`);
      console.log(`created:  ${result.written.filter((item) => !item.skipped).map((item) => item.dest).join(", ")}`);
      if (skipped.length > 0) console.log(`kept:     ${skipped.join(", ")}`);
      if (result.gitMessage) console.log(`git:      ${result.gitMessage}`);
      if (skipped.includes("clx.config.json")) {
        console.log("note:     existing clx.config.json was kept; its rom/spec win over --rom/--spec");
      }
      console.log("");
      console.log("next:");
      console.log(`  node ${path.join(SKILL_ROOT, "scripts", "clx.mjs")} build`);
      console.log(`  node ${path.join(SKILL_ROOT, "scripts", "clx.mjs")} run`);
      return;
    }

    case "build": {
      const result = await buildProject(flags);
      const relative = path.relative(process.cwd(), result.output);
      const shown = relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : result.output;
      console.log(`built ${shown}`);
      console.log(`size  ${formatBytes(result.size)}`);
      return;
    }

    case "run": {
      if (flags.foreground) die('run is background-only; use "run" then "debug" or "shot"');
      const result = await runSimulator(flags);
      console.log(`running pid ${result.pid} on 127.0.0.1:${DEBUG_PORT}`);
      console.log(`log ${result.log}`);
      console.log(`entry ${result.project.entry}`);
      return;
    }

    case "stop": {
      const result = await stopSimulator(flags);
      if (result.stopped) console.log(`stopped pid ${result.pid}`);
      return;
    }

    case "status": {
      const result = await simulatorStatus(flags);
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`running:  ${result.running ? "yes" : "no"}`);
        if (result.pid) console.log(`pid:      ${result.pid}${result.pidAlive ? "" : " (not alive)"}`);
        console.log(`port:     ${DEBUG_PORT} ${result.portOpen ? "open" : "closed"}`);
        if (result.entry) console.log(`entry:    ${result.entry}`);
        if (result.log) console.log(`log:      ${result.log}`);
      }
      return;
    }

    case "debug": {
      const result = await debugSession(flags);
      if (result.response) {
        process.stdout.write(result.response);
        if (!result.response.endsWith("\n")) process.stdout.write("\n");
      }
      return;
    }

    case "shot": {
      const result = await takeShot(flags);
      console.log(`path ${result.path}`);
      console.log(`size ${formatBytes(result.size)}`);
      console.log(`md5  ${result.md5 || "unknown"}`);
      if (result.expected && !result.matched) {
        die(`pixel md5 mismatch: expected ${result.expected}, got ${result.md5}`, 1);
      }
      return;
    }

    case "docs": {
      const query = positionals.join(" ").trim();
      if (!query) {
        const index = await readDocsIndex(flags);
        console.log(`docs ${index.lang}: ${index.guide}`);
        console.log("");
        console.log(index.text.split(/\r?\n/).slice(0, 120).join("\n"));
        return;
      }
      const result = await searchDocs(query, flags);
      if (result.matches.length === 0) {
        console.log(`no matches for "${query}" in ${result.guide}`);
        process.exit(1);
      }
      for (const match of result.matches) {
        console.log(`${match.file}:${match.line}: ${match.text}`);
      }
      return;
    }

    default: {
      console.error(`unknown command: ${command}`);
      printHelp();
      process.exit(1);
    }
  }
}

try {
  await main();
} catch (err) {
  die(err.message || String(err));
}
