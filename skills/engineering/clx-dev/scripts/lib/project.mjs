import { spawnSync } from "node:child_process";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  DEFAULT_SPEC,
  SKILL_ROOT,
  assertSafeRomName,
  ensureDir,
  pathExists,
  resolveDocsLang,
  runCommand,
  toolArtifactKey,
  warn,
} from "./common.mjs";
import { ensureArtifact, installedArtifact } from "./download.mjs";

export async function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (await pathExists(path.join(dir, "clx.config.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('no clx.config.json found; run "init" first or pass --root <dir>');
}

export async function resolveProjectRoot(flags = {}) {
  if (flags.root) {
    const root = path.resolve(String(flags.root));
    if (!(await pathExists(path.join(root, "clx.config.json")))) {
      throw new Error(`no clx.config.json in ${root}`);
    }
    return root;
  }
  return findProjectRoot(process.cwd());
}

export async function loadProject(root) {
  const file = path.join(root, "clx.config.json");
  let config;
  try {
    config = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    throw new Error(`cannot read ${file}: ${err.message}`);
  }
  if (!config.rom || typeof config.rom !== "string") {
    throw new Error(`${file} is missing a string "rom" field`);
  }
  assertSafeRomName(config.rom);
  const spec = config.spec || DEFAULT_SPEC;
  const entry = config.entry || `${config.rom}.clx`;
  if (path.isAbsolute(entry)) throw new Error('"entry" must be relative to the project root');
  const entryAbs = path.resolve(root, entry);
  const relative = path.relative(root, entryAbs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error('"entry" must stay inside the project root');
  }
  return { ...config, spec, entry, entryAbs, root };
}

async function listEntries(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

function isInsideGitRepo(dir) {
  const result = runCommand("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
  return result.status === 0;
}

function gitUserName() {
  const result = runCommand("git", ["config", "user.name"]);
  return result.status === 0 ? result.stdout.trim() : "";
}

function render(text, vars) {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    if (!(key in vars)) return match;
    return vars[key];
  });
}

async function writeRendered(sourceRel, destRel, target, vars, merge) {
  const source = path.join(SKILL_ROOT, "assets", "template", sourceRel);
  const dest = path.join(target, destRel);
  if (await pathExists(dest)) {
    if (merge) return { dest: destRel, skipped: true };
    throw new Error(`${destRel} already exists`);
  }
  await ensureDir(path.dirname(dest));
  const text = render(await readFile(source, "utf8"), vars);
  await writeFile(dest, text, "utf8");
  return { dest: destRel, skipped: false };
}

async function writeLiteral(sourceRel, destRel, target, merge) {
  const source = path.join(SKILL_ROOT, "assets", "template", sourceRel);
  const dest = path.join(target, destRel);
  if (await pathExists(dest)) {
    if (merge) return { dest: destRel, skipped: true };
    throw new Error(`${destRel} already exists`);
  }
  await ensureDir(path.dirname(dest));
  await writeFile(dest, await readFile(source), "utf8");
  return { dest: destRel, skipped: false };
}

export async function initProject(positionals, flags) {
  const name = positionals[0];
  const cwd = process.cwd();
  const here = Boolean(flags.here);

  if (!name && !here && (await listEntries(cwd)).filter((entry) => entry !== ".git" && entry !== ".DS_Store").length > 0) {
    throw new Error(
      "current directory is not empty; use \"init <name>\" for a subdirectory, or \"init --here --merge\" to add files here",
    );
  }

  const target = here || !name ? cwd : path.resolve(cwd, name);
  const existing = await listEntries(target);
  const meaningful = existing.filter((entry) => entry !== ".git" && entry !== ".DS_Store");
  if (meaningful.length > 0 && !flags.merge) {
    const sample = meaningful.slice(0, 5).join(", ");
    throw new Error(
      `${target} is not empty (${sample}${meaningful.length > 5 ? ", ..." : ""}); use "init <name>" or "init --here --merge"`,
    );
  }

  let rom = String(flags.rom || (name ? path.basename(name) : path.basename(target))).trim();
  let spec = String(flags.spec || DEFAULT_SPEC);
  let entry = `${rom}.clx`;

  const configFile = path.join(target, "clx.config.json");
  if (flags.merge && (await pathExists(configFile))) {
    let config;
    try {
      config = JSON.parse(await readFile(configFile, "utf8"));
    } catch (err) {
      throw new Error(`cannot read existing clx.config.json: ${err.message}`);
    }
    if (!config.rom || typeof config.rom !== "string") {
      throw new Error("existing clx.config.json is missing a string \"rom\" field");
    }
    if (flags.rom && String(flags.rom) !== config.rom) {
      warn(`keeping existing rom "${config.rom}" instead of --rom "${flags.rom}"`);
    }
    rom = config.rom;
    spec = String(config.spec || DEFAULT_SPEC);
    entry = String(config.entry || `${rom}.clx`);
  }

  assertSafeRomName(rom);
  if (path.isAbsolute(entry)) throw new Error("\"entry\" in clx.config.json must be relative");
  const entryRelative = path.relative(target, path.resolve(target, entry));
  if (entryRelative.startsWith("..") || path.isAbsolute(entryRelative)) {
    throw new Error("\"entry\" in clx.config.json must stay inside the project");
  }

  const author = String(flags.author || gitUserName() || "");
  const lang = resolveDocsLang(flags.lang);

  const toolKey = toolArtifactKey();
  if (!toolKey) {
    throw new Error(`unsupported platform: ${process.platform}; only macOS and Windows are supported`);
  }

  const required = [toolKey, "examples"];
  if (!flags["no-docs"]) required.push(`docs:${lang}`);

  for (const key of required) {
    if (flags.offline) {
      if (!(await installedArtifact(key))) {
        warn(`${key} is not cached; continuing because --offline was set`);
      }
      continue;
    }
    try {
      await ensureArtifact(key, { offline: false });
    } catch (err) {
      throw new Error(`cannot prepare ${key}: ${err.message}`);
    }
  }

  await ensureDir(target);

  const vars = {
    ROM: rom,
    ENTRY: entry,
    SPEC: spec,
    AUTHOR: author,
    PROJECT: path.basename(target),
    DATE: new Date().toISOString().slice(0, 10),
  };

  const written = [];
  written.push(await writeRendered("entry.clx.template", entry, target, vars, flags.merge));
  written.push(await writeLiteral("src/main.lua", path.join("src", "main.lua"), target, flags.merge));
  written.push(await writeRendered("README.md.template", "README.md", target, vars, flags.merge));
  written.push(await writeRendered("clx.config.json.template", "clx.config.json", target, vars, flags.merge));
  written.push(await writeRendered("gitignore.template", ".gitignore", target, vars, flags.merge));

  const assetsKeep = path.join(target, "assets", ".gitkeep");
  if (!(await pathExists(assetsKeep))) {
    await ensureDir(path.dirname(assetsKeep));
    await writeFile(assetsKeep, "", "utf8");
    written.push({ dest: path.join("assets", ".gitkeep"), skipped: false });
  }

  let gitMessage = "";
  if (!flags["no-git"]) {
    if (isInsideGitRepo(target)) {
      const root = runCommand("git", ["-C", target, "rev-parse", "--show-toplevel"]).stdout.trim();
      gitMessage = `git repository already exists at ${root}; left untouched`;
    } else {
      let result = runCommand("git", ["init", "-b", "main"], { cwd: target });
      if (result.status !== 0) result = runCommand("git", ["init"], { cwd: target });
      if (result.status !== 0) {
        warn("git init failed; the project files are still usable");
      } else {
        gitMessage = "initialized a git repository (nothing committed)";
      }
    }
  } else {
    gitMessage = "skipped git initialization (--no-git)";
  }

  return {
    target,
    rom,
    spec,
    entry,
    lang,
    written: written.map((item) => ({ ...item, dest: item.dest.split(path.sep).join("/") })),
    gitMessage,
  };
}

export async function buildProject(flags) {
  const root = await resolveProjectRoot(flags);
  const project = await loadProject(root);

  if (!(await pathExists(project.entryAbs))) {
    throw new Error(`entry file not found: ${project.entry}`);
  }
  const firstLine = (await readFile(project.entryAbs, "utf8")).split(/\r?\n/, 1)[0].trim();
  if (firstLine && firstLine !== project.spec) {
    warn(`entry declares "${firstLine}" but clx.config.json says "${project.spec}"`);
  }

  const toolKey = toolArtifactKey();
  if (!toolKey) throw new Error(`unsupported platform: ${process.platform}`);
  const executable = await ensureArtifact(toolKey);

  const output = flags.out
    ? path.resolve(process.cwd(), String(flags.out))
    : path.join(root, "dist", `${project.rom}.rom`);
  await ensureDir(path.dirname(output));

  const workspace = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const result = spawnSync(
    executable,
    ["-d", workspace, "-r", project.entry, "-b", output],
    { cwd: root, encoding: "utf8", timeout: 120000 },
  );

  if (result.error) throw new Error(`failed to run coloXtool: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stdout || ""}\n${result.stderr || ""}`.trim().split(/\r?\n/).slice(-12).join("\n");
    throw new Error(`coloXtool exited with code ${result.status}\n${detail}`);
  }

  if (!(await pathExists(output))) throw new Error(`build finished but ${output} was not created`);
  const sidecar = path.join(root, `${project.entry}.rom`);
  if (path.resolve(sidecar) !== path.resolve(output)) await rm(sidecar, { force: true });

  const { size } = await stat(output);
  return { output, size, project };
}
