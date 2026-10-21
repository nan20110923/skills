---
name: clx-dev
description: Scaffold, build, run, and debug coloX cartridges for ColoPLAY and ColoPLAY V2 hardware. Use when the user wants to create a coloX/.clx app, build a ROM for ColoPLAY, run or debug a cartridge, capture a frame, search the coloX API docs, or set up a new coloX development project.
---

# coloX cartridge development

This skill wraps the official coloX toolchain: it caches the `coloXtool`
simulator and the official documentation, scaffolds a project, builds a `.rom`,
runs the simulator, and talks to the debug channel on TCP port 3563.

## Command prefix

Run commands from the user's project directory. Resolve `scripts/clx.mjs`
relative to this skill directory:

```bash
node <skill-dir>/scripts/clx.mjs <command>
```

Do not call `coloXtool` directly. The wrapper handles the `-d` trailing slash,
the required `-b` ordering, the global cache, and the duplicate sidecar ROM.

The official simulator is distributed for macOS (Intel; Rosetta on Apple
Silicon) and Windows. Linux is not supported.

## First run

1. Run `doctor` to check the platform, Rosetta (macOS), tool, docs, examples,
   and debug port.
2. Run `init` to scaffold a project. Map the user's intent:
   - "create a new game/project" → `init <name>`
   - "work in this directory" → `init --here --rom <name>`
   - the directory already has files → `init --here --rom <name> --merge`
3. Run `build`, then `run`.

Artifacts are downloaded once into `~/.cache/clx-dev` and reused. Override the
location with `CLX_DEV_HOME`. `init` fetches the tool, examples, and docs.
`--no-docs` skips the docs bundle; `--offline` skips all downloads and only
warns about anything missing.

The scaffold creates:

```text
<rom>.clx          cartridge header + #include src/main.lua
src/main.lua       lifecycle callbacks and game code
assets/            images, audio, and data embedded with #blob / #png
dist/              generated ROMs (gitignored)
clx.config.json    rom, spec, entry
README.md
.gitignore
```

The default spec is `coloX-16` (ColoPLAY, 240×240). Use
`--spec coloX-16C` for ColoPLAY V2 (480×480, touch, no buttons). Do not add a
`.vscode/` directory: the user may not use VS Code.

## Build

`build` reads `clx.config.json` and writes `dist/<rom>.rom`. It warns when the
cartridge header spec differs from the config. The official tool requires
`-d <root>/` with a trailing slash and `-b` after `-r`; the wrapper handles both
and removes the duplicate `<entry>.clx.rom` sidecar.

## Run and debug

- `run` starts the simulator detached, waits for port 3563, and writes
  `.clx-dev/run.json`.
- Only one simulator can own port 3563. `run` fails if another process has it.
- `debug --cmd "vmlist"` runs one command; `debug` opens a REPL when stdin is
  a TTY.
- Use `--vm <index>` after `vmlist` when the BIOS menu VM owns the channel.
- `shot` captures the current frame and prints the pixel md5. Compare it with
  `--expect <md5>` for a golden-image check.
- `stop` terminates the simulator; `status` reports PID and port state.

Examples:

```bash
node <skill-dir>/scripts/clx.mjs debug --cmd "input?"
node <skill-dir>/scripts/clx.mjs debug --cmd "btn LEFT 30"
node <skill-dir>/scripts/clx.mjs debug --cmd "shot /tmp/frame.bmp"
node <skill-dir>/scripts/clx.mjs shot --expect <md5>
node <skill-dir>/scripts/clx.mjs stop
```

Debug commands are frame-boundary processed. Input injection is frame-accurate.
See `references/debug-protocol.md` for the full command list.

## Documentation

`docs` prints the cached index. `docs <query>` searches the cached Markdown and
prints `file:line` matches.

Language resolution: `--lang` > `CLX_DOCS_LANG` > `LC_ALL` / `LANG`
(`zh*` → `zh-CN`, everything else → `en`). Pass `--lang zh` when the user works
in Chinese, even if the machine locale is English.

## API reference

`references/cheatsheet.md` covers the cartridge format, lifecycle callbacks,
common graphics/input/audio functions, and spec limits. Read it before writing
game code, then use `docs <query>` for the full official text.

## Troubleshooting

- `doctor` reports a missing tool or docs: run `doctor --refresh`.
- macOS on Apple Silicon needs Rosetta for the Intel build; `doctor` checks it.
- `port 3563 is already in use`: run `stop`, or close the other simulator.
- `-d` issues: never call `coloXtool` directly; the wrapper always appends the
  trailing slash.
- A cartridge rejected at load time: check the spec line, `version`, and ROM
  size against `references/cheatsheet.md`.
- Do not edit files under `~/.cache/clx-dev`; run `doctor --refresh` instead.
