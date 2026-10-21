#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SKILLS_DIR = path.join(ROOT, "skills");
const TEMPLATES_DIR = path.join(ROOT, "templates");

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DESCRIPTION_LENGTH = 1024;
const RECOMMENDED_DESCRIPTION_LENGTH = 500;
const MAX_SKILL_DIR_PARTS = 3;

const URL_RULES = [
  { label: "plain http:// URL", re: /(^|[^\w])http:\/\// },
  { label: "localhost", re: /\blocalhost\b/i },
  { label: "loopback address", re: /\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ },
  {
    label: "private network address",
    re: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/,
  },
  { label: ".local hostname", re: /\b[a-z0-9][a-z0-9-]*\.local\b/i },
];

const SECRET_RULES = [
  {
    label: "private key",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  },
  { label: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/ },
  {
    label: "GitHub fine-grained token",
    re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  },
  { label: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: "OpenAI-style API key", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
];

const PLACEHOLDERS = [/<skill-name>/, /<category>/, /\bTODO\b/, /\bFIXME\b/];

const errors = [];
const warnings = [];
const skills = [];

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function error(file, message, text, index) {
  const where = typeof index === "number" ? `${rel(file)}:${lineOf(text, index)}` : rel(file);
  errors.push(`${where}: ${message}`);
}

function warn(file, message, text, index) {
  const where = typeof index === "number" ? `${rel(file)}:${lineOf(text, index)}` : rel(file);
  warnings.push(`${where}: ${message}`);
}

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return out;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function parseFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return { error: "file must start with a YAML frontmatter block (---)" };
  }
  const lines = normalized.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return { error: "frontmatter is missing its closing ---" };
  return {
    block: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n"),
  };
}

function readScalar(block, key) {
  const lines = block.split(/\r?\n/);
  const pattern = new RegExp(`^${key}:\\s*(.*)$`);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(pattern);
    if (!match) continue;
    let value = match[1].trim();
    if (/^[|>][+-]?$/.test(value)) {
      const fold = value.startsWith(">");
      const collected = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === "") {
          collected.push("");
        } else if (/^\s+\S/.test(lines[j])) {
          collected.push(lines[j].replace(/^\s{2}/, ""));
        } else {
          break;
        }
      }
      return collected.join(fold ? " " : "\n").replace(/\s+/g, " ").trim();
    }
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
      try {
        return JSON.parse(value);
      } catch {
        return value.slice(1, -1);
      }
    }
    if (value.startsWith("'") && value.endsWith("'") && value.length > 1) {
      return value.slice(1, -1).replace(/''/g, "'");
    }
    return value;
  }
  return null;
}

function checkRules(file, text) {
  for (const rule of URL_RULES) {
    const match = rule.re.exec(text);
    if (match) error(file, `contains a ${rule.label}: ${match[0].trim()}`, text, match.index);
  }
  for (const rule of SECRET_RULES) {
    const match = rule.re.exec(text);
    if (match) error(file, `looks like it contains a ${rule.label}`, text, match.index);
  }
  for (const pattern of PLACEHOLDERS) {
    const match = pattern.exec(text);
    if (match) warn(file, `still contains template placeholder ${match[0]}`, text, match.index);
  }
}

function checkReferencedPaths(file, text, skillDir) {
  const linkRe = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of text.matchAll(linkRe)) {
    const raw = match[1];
    if (/^(?:#|https?:|mailto:)/i.test(raw)) continue;
    if (raw.includes("*") || raw.includes("{")) continue;
    const target = decodeURIComponent(raw.split("#")[0].split("?")[0]);
    if (!target) continue;
    const resolved = path.resolve(skillDir, target);
    if (!existsSync(resolved)) {
      error(file, `link target does not exist: ${target}`, text, match.index);
    }
  }

  const codeRe = /`([^`\n]+)`/g;
  for (const match of text.matchAll(codeRe)) {
    const candidate = match[1].trim();
    if (!/^(?:\.\/|references\/|scripts\/|assets\/)/.test(candidate)) continue;
    if (/\s/.test(candidate) || candidate.includes("*") || candidate.includes("{")) continue;
    const resolved = path.resolve(skillDir, candidate);
    if (!existsSync(resolved)) {
      error(file, `referenced path does not exist: ${candidate}`, text, match.index);
    }
  }
}

async function checkSkill(file) {
  const dirParts = path.relative(SKILLS_DIR, path.dirname(file)).split(path.sep).filter(Boolean);
  if (dirParts.length === 0) {
    error(file, "SKILL.md must live inside a skill directory");
    return;
  }
  if (dirParts.length > MAX_SKILL_DIR_PARTS) {
    error(
      file,
      `skill is nested ${dirParts.length} directories deep; the maximum is ${MAX_SKILL_DIR_PARTS}`,
    );
    return;
  }

  const expectedName = dirParts[dirParts.length - 1];
  const text = await readFile(file, "utf8");
  const parsed = parseFrontmatter(text);
  if (parsed.error) {
    error(file, parsed.error);
    return;
  }

  const name = readScalar(parsed.block, "name");
  const description = readScalar(parsed.block, "description");

  if (!name) {
    error(file, "frontmatter is missing the required name field");
  } else {
    if (!NAME_RE.test(name)) {
      error(file, `name "${name}" must be lowercase kebab-case`);
    }
    if (name !== expectedName) {
      error(file, `name "${name}" must match the directory name "${expectedName}"`);
    }
  }

  if (!description) {
    error(file, "frontmatter is missing the required description field");
  } else {
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      error(
        file,
        `description is ${description.length} characters; the maximum is ${MAX_DESCRIPTION_LENGTH}`,
      );
    } else if (description.length > RECOMMENDED_DESCRIPTION_LENGTH) {
      warn(
        file,
        `description is ${description.length} characters; aim for ${RECOMMENDED_DESCRIPTION_LENGTH} or fewer`,
      );
    }
    if (!/\buse when\b/i.test(description)) {
      warn(file, 'description does not contain a "Use when ..." trigger sentence');
    }
  }

  if (!parsed.body.trim()) {
    error(file, "body is empty");
  }

  checkRules(file, text);
  checkReferencedPaths(file, text, path.dirname(file));

  if (name) skills.push({ name, file });
}

async function main() {
  const files = await walk(SKILLS_DIR);
  const skillFiles = files.filter((file) => path.basename(file) === "SKILL.md");

  for (const file of skillFiles) {
    await checkSkill(file);
  }

  const seen = new Map();
  for (const { name, file } of skills) {
    const previous = seen.get(name);
    if (previous) {
      error(file, `duplicate skill name "${name}" (also used by ${rel(previous)})`);
    } else {
      seen.set(name, file);
    }
  }

  const templateFiles = (await walk(TEMPLATES_DIR)).filter(
    (file) => path.basename(file) === "SKILL.md",
  );
  for (const file of templateFiles) {
    error(
      file,
      "templates must not be named SKILL.md; the skills CLI treats any SKILL.md as installable",
    );
  }

  for (const message of warnings) console.log(`warn  ${message}`);
  for (const message of errors) console.log(`error ${message}`);

  const skillCount = skillFiles.length;
  if (skillCount === 0) {
    console.log("No skills found under skills/. Nothing to validate yet.");
  } else {
    console.log(
      `${skillCount} skill${skillCount === 1 ? "" : "s"} checked, ${errors.length} error${
        errors.length === 1 ? "" : "s"
      }, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`,
    );
  }

  process.exit(errors.length === 0 ? 0 : 1);
}

await main();
