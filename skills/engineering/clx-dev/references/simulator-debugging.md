# Simulator debugging and verification

How to inspect a running cartridge, avoid debugger crashes, and verify a build
without relying on manual clicking. See [debug-protocol.md](debug-protocol.md)
for the full command set.

## Debug channel basics

The simulator exposes a line-based debug channel on TCP 3563. The wrapper
commands are:

```bash
node <skill-dir>/scripts/clx.mjs run
node <skill-dir>/scripts/clx.mjs probe --root test/probe
node <skill-dir>/scripts/clx.mjs debug --cmd "vmlist"
node <skill-dir>/scripts/clx.mjs debug --cmd "pause"
node <skill-dir>/scripts/clx.mjs debug --cmd "p some_global"
node <skill-dir>/scripts/clx.mjs debug --cmd "c"
node <skill-dir>/scripts/clx.mjs stop
```

Commands are processed at frame boundaries. `btn` injection is frame-accurate.
Use `--vm <index>` after `vmlist` if the BIOS menu VM owns the channel.

For a sequence of commands, put one per line in a project-relative file and
send it over one connection:

```bash
node <skill-dir>/scripts/clx.mjs debug --batch test/debug.txt
```

Blank lines and lines starting with `#` are skipped. Use `--batch -` to read
from stdin.

## Known simulator limits

These are tool limitations, not cartridge bugs. They have been observed with
the macOS simulator build used by this skill:

- Very long `r` or `p` commands can crash the debugger in
  `coloX_dbg_loop_msg` (stack smashing).
- Calling `wave('I')` or `wave('R')` while the VM is paused can crash the
  simulator.
- `p` truncates long strings in its response.

Keep debugger commands short. Move long test code, large fixtures, and hex
dumps into a probe cartridge. Split a long string into several short prints
instead of asking `p` for the whole value.

## Probe cartridges

A probe cartridge is a throwaway `.clx` whose `_init` or `_update` runs a test
and prints markers with `printh`. Use one when:

- The test needs more than a few lines of code.
- The test needs frames, input, audio, or a network peer.
- The output is long or needs to be compared repeatably.
- The debugger has crashed and you need a stable path.

Create a small project root with its own `clx.config.json` and entry:

```text
test/probe/
  clx.config.json   {"rom":"probe","spec":"coloX-16","entry":"probe.clx"}
  probe.clx
  src/              modules under test, if needed
```

Minimal entry:

```text
coloX-16
version 1
style:game
name:probe
author:test
desc:probe

__lua__
local frames = 0

function _init()
  printh("probe: start")
end

function _update()
  frames = frames + 1
  if frames == 30 then
    -- Replace this with the actual test.
    printh("probe: result", 42)
    printh("probe: done")
  end
end

function _draw()
  cls(0)
end
```

Run it with:

```bash
node <skill-dir>/scripts/clx.mjs probe --root test/probe
```

`probe` starts the simulator, waits for `probe: done` (override with
`--until <text>`), stops the simulator, and prints the log. The timeout defaults
to 20 seconds; use `--timeout <seconds>` for a slower test. `--tail <n>` limits
the printed log, and `--keep` leaves the simulator running for inspection.

The marker must be written with `printh`, not `print`; `print` draws on screen
and never reaches the log. `--keep` leaves the simulator running after the probe
finishes or times out, so you can inspect it:

```bash
node <skill-dir>/scripts/clx.mjs probe --root test/probe --keep
node <skill-dir>/scripts/clx.mjs logs --root test/probe
node <skill-dir>/scripts/clx.mjs stop --root test/probe
```

For an interactive probe, start it with `run --root test/probe` instead and
stop it manually; `probe` waits for a marker and is meant for automated checks.

Use `_init` for immediate checks and `_update` when the test needs frames,
input, or time. If the probe needs a peer, start a host-side UDP/TCP peer before
running it (see [network.md](network.md)). Keep probe carts out of the release
entry and out of `dist/` artifacts.

## Logs

- `printh(...)` writes to the host log at `.clx-dev/run.log`.
- `print(...)` draws on screen and is not captured in the log.
- Read errors and probe markers with `logs`:

```bash
node <skill-dir>/scripts/clx.mjs logs
node <skill-dir>/scripts/clx.mjs logs --tail 200
node <skill-dir>/scripts/clx.mjs logs --grep "ERROR|probe:"
node <skill-dir>/scripts/clx.mjs logs --all
```

For a probe project, pass `--root test/probe`. `--grep` is a case-insensitive
regex. The log is still plain text at `.clx-dev/run.log`; use `grep`/`tail` for
filters that `logs` does not cover.

- On macOS, simulator crash reports are under
  `~/Library/Logs/DiagnosticReports/coloXtool-*.ips`.
- If the simulator dies, `stop` may report that it is not running; start a fresh
  `run` instead of reusing the old state.

## Frames and golden images

`shot` captures the current frame and prints the pixel md5. Use `--expect` for a
golden-image check:

```bash
node <skill-dir>/scripts/clx.mjs shot --expect <md5>
```

For a probe project, pass `--root test/probe` so the bitmap and golden check
use the probe root.

Make screenshots deterministic: pause on a known frame, avoid animations,
time-dependent text, and unseeded randomness. If a value changes every frame,
inject the same input or set a fixed test state before capturing.

## Input injection

Use `btn` commands to exercise controls without a physical device:

```bash
node <skill-dir>/scripts/clx.mjs debug --cmd "btn CENTER"
node <skill-dir>/scripts/clx.mjs debug --cmd "btn 0"
node <skill-dir>/scripts/clx.mjs debug --cmd "input?"
```

Check the button names and touch commands in
[debug-protocol.md](debug-protocol.md). Release every button you press; a stuck
input makes later tests misleading.

## Safe workflow

1. `run` and wait for the port to open.
2. Run `logs --grep ERROR` and confirm the boot.
3. Interact with `btn`, `debug`, and `shot`.
4. `pause` only for short inspections; keep `p` and `r` commands small.
5. Resume with `c` or stop with `stop`.
6. If the debugger crashes, restart the simulator and use a probe cartridge for
   the heavy part.

Do not call audio initialization or reset from the paused debugger. Do not
leave a VM paused while editing and rebuilding; start from a clean process.

## Verification matrix

| Area | Normal path | Failure or fallback |
| --- | --- | --- |
| Build | Build succeeds, ROM boots | Missing asset or include is reported clearly |
| Input | Every control works | Released/stuck buttons are handled |
| Audio | Playback and capture work | No microphone permission or no Opus support |
| Network | Peer discovery and data exchange | No network module, no peer, blocked broadcast |
| Data | Current format loads | Old or corrupt format is rejected or migrated |
| Release | Release ROM boots | Debug output is absent and behavior is unchanged |

For each row, record the command, the observed output, and a screenshot or log
line. "It built" is not verification.

## Pitfalls

- The simulator frame rate and audio latency differ from hardware; do not tune
  production constants to the simulator alone.
- Host microphone permission affects capture. A successful module load does not
  mean the captured signal is non-silent.
- A desktop loopback peer does not reproduce Wi-Fi client isolation, packet
  loss, or weak signal.
- Long-running loops in `_update` can stall the debug channel; keep test frames
  bounded.
- A command that works at one frame boundary may fail while paused; follow the
  safe workflow.
- A probe that prints its marker with `print` will never match; `print` draws on
  screen, while `printh` writes to the log.
