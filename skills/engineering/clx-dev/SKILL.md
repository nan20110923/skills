---
name: clx-dev
description: Scaffold, build, run, debug, test, and release coloX cartridges for ColoPLAY and ColoPLAY V2 hardware. Use when the user wants to create a coloX/.clx app, work with audio or networking, build a ROM, run or debug a cartridge, capture a frame, search the coloX API docs, or set up a new coloX development project.
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

Decide the documentation language once, then pass the same `--lang` to every
command below. Use `--lang zh` when the user works in Chinese, even if the
machine locale is English.

1. Run `doctor --refresh` on a fresh machine to check the platform, Rosetta
   (macOS), tool, examples, and debug port. It downloads the tool and examples;
   the docs bundle is downloaded by `init` for the chosen language.
2. Run `init` to scaffold a project. Map the user's intent:
   - "create a new game/project" → `init <name>`
   - "work in this directory" → `init --here --rom <name>`
   - the directory already has files → `init --here --rom <name> --merge`
3. Run `build`, then `run`.

Artifacts are downloaded once into `~/.cache/clx-dev` and reused. Override the
location with `CLX_DEV_HOME`. Downloads use a proxy when one is configured:
`CLX_PROXY` first, then `HTTPS_PROXY` / `ALL_PROXY` / `HTTP_PROXY`, then the
macOS or Windows system proxy. `CLX_PROXY=none` forces a direct connection and
`CLX_NO_PROXY` skips the proxy for matching hosts. `doctor` prints the proxy it
would use and each download prints `via <proxy>` or `(direct)`. http(s) and
socks5 proxies are supported.

`init` fetches the tool, examples, and the docs bundle for the resolved
language only. `--no-docs` skips the docs bundle; `--offline` skips all
downloads and only warns about anything missing.

The scaffold creates:

```text
<rom>.clx          cartridge header + #include src/main.lua
src/main.lua       lifecycle callbacks, DEBUG/dlog helper, game code
assets/            images, audio, and data embedded with #blob / #png
dist/              generated ROMs (gitignored)
clx.config.json    rom, spec, entry, docs lang
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

`build --release` copies the project to a temporary directory, fails if any
`DEBUG = true` assignment is found in the copied sources, strips single-line
`dlog()` calls, and builds from the copy. The source tree is not modified. Add
`--out <file>` to choose the release ROM path.

## Debug logging

Use a top-level `DEBUG` constant and a `dlog()` wrapper around `printh()`; keep
each call on one line so `build --release` can strip it. `print` draws on
screen, `printh` writes to the host log. See `references/release.md`.

## Run and debug

- `run` starts the simulator detached, waits for port 3563, and writes
  `.clx-dev/run.json`.
- Only one simulator can own port 3563. `run` fails if another process has it.
- `debug --cmd "vmlist"` runs one command; `debug` opens a REPL when stdin is
  a TTY.
- `debug --batch <file>` sends one command per line over one connection. The
  path is relative to the project root; `-` reads stdin.
- `probe` starts a probe project, waits for `probe: done` (or `--until <text>`),
  stops it, and prints the log. Use `--timeout`, `--tail`, and `--keep` to
  control a slow probe or inspect a finished one.
- Use `--vm <index>` after `vmlist` when the BIOS menu VM owns the channel.
- `shot` captures the current frame and prints the pixel md5. Compare it with
  `--expect <md5>` for a golden-image check.
- `logs` prints the simulator log (last 80 lines). Use `--tail <n>`, `--all`,
  or `--grep <regex>` (case-insensitive) to narrow it.
- `stop` terminates the simulator; `status` reports PID and port state.

Examples:

```bash
node <skill-dir>/scripts/clx.mjs debug --cmd "input?"
node <skill-dir>/scripts/clx.mjs debug --cmd "btn LEFT 30"
node <skill-dir>/scripts/clx.mjs debug --batch test/debug.txt
node <skill-dir>/scripts/clx.mjs debug --cmd "shot /tmp/frame.bmp"
node <skill-dir>/scripts/clx.mjs probe --root test/probe
node <skill-dir>/scripts/clx.mjs shot --expect <md5>
node <skill-dir>/scripts/clx.mjs logs --grep "ERROR|warning"
node <skill-dir>/scripts/clx.mjs stop
```

Debug commands are frame-boundary processed. Input injection is frame-accurate.
See `references/debug-protocol.md` for the full command list.

Long debugger commands and audio init/reset (`wave('I')`, `wave('R')`) while
paused can crash the simulator. Keep commands short and move heavy tests into a
probe cartridge; see `references/simulator-debugging.md`.

## Documentation

`docs` prints the cached index. `docs <query>` searches the cached Markdown and
prints `file:line` matches.

Language resolution: `--lang` > `CLX_DOCS_LANG` > the project's
`clx.config.json` (`lang`) > `LC_ALL` / `LANG` (`zh*` → `zh-CN`, everything
else → `en`). `init` records the chosen language, so later `docs` and `doctor`
runs inside the project keep using it. Pass `--lang zh` when the user works in
Chinese, even if the machine locale is English.

## API reference

`references/cheatsheet.md` covers the cartridge format, lifecycle callbacks,
common graphics/input/audio functions, and spec limits. Read it before writing
game code, then use `docs <query>` for the full official text.

- `references/audio.md`: `wave`/`micpoll`, codecs, Opus framing, embedded audio,
  and streaming.
- `references/network.md`: sockets, local discovery, binary protocols, and
  host-side test peers.
- `references/simulator-debugging.md`: safe debugger use, probe cartridges,
  logs, and golden screenshots.
- `references/release.md`: debug stripping, overlays, versioning, and the
  release checklist.

## Quality gate

Before calling a cartridge done:

- Build without warnings; run it and confirm it boots.
- Exercise the main path and at least one fallback (missing module or
  permission, no peer, old data, release build).
- Run `logs --grep ERROR` and check `.clx-dev/run.log` for unexpected output.
  `printh` writes there; `print` draws on screen.
- Capture key screens with `shot`; use `shot --expect` for golden checks.
- Run `build --release`, leave `statctl('dfps')` off, and bump format/protocol
  versions when layouts change.

## Troubleshooting

- `doctor` reports a missing tool or examples: run `doctor --refresh`.
- Downloads are slow or stall: read the `proxy:` line from `doctor`. If it says
  `none`, set `CLX_PROXY` to the proxy URL the user already runs (scheme, host,
  and port, as shown in their proxy app) and retry; a direct connection to the
  CDN is often far slower.
- `doctor` shows docs for another language than the user wants: pass
  `--lang zh` or `--lang en`; each language is a separate bundle, cached on
  first use.
- macOS on Apple Silicon needs Rosetta for the Intel build; `doctor` checks it.
- `build --release` fails with `DEBUG = true`: set `DEBUG = false` in the source;
  the release build strips a copy, not the original.
- `build --release` warns about direct `printh()`: move the call into `dlog()`
  or remove it before shipping.
- `probe` times out: make sure the marker uses `printh` and the code path runs;
  raise `--timeout`, or rerun with `--keep` and inspect with `logs`.
- `port 3563 is already in use`: run `stop`, or close the other simulator.
- `-d` issues: never call `coloXtool` directly; the wrapper always appends the
  trailing slash.
- A cartridge rejected at load time: check the spec line, `version`, and ROM
  size against `references/cheatsheet.md`.
- Do not edit files under `~/.cache/clx-dev`; run `doctor --refresh` instead.
