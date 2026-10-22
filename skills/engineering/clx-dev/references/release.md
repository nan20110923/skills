# Release builds and versioning

How to keep debug output out of a release ROM, remove debug overlays, and
version data or wire formats so old and new builds do not silently disagree.

## Debug logging convention

Lua has no preprocessor. Use a top-level flag and a small wrapper:

```lua
DEBUG = false

function dlog(fmt, ...)
  if not DEBUG then return end
  local ok, s = pcall(string.format, fmt, ...)
  printh(ok and s or tostring(fmt))
end
```

- `print(...)` draws on screen. `printh(...)` writes to the host log. Never use
  `print` for diagnostics.
- Keep every `dlog(...)` call on its own line. A release pass can then remove
  those lines without parsing Lua.
- Do not put side effects in a `dlog` call. Removing the line must not change
  behavior.
- If a diagnostic value is expensive to compute, guard the call with
  `if DEBUG then ... end`; the wrapper only skips the print.

## Strip debug calls

Run:

```bash
node <skill-dir>/scripts/clx.mjs build --release
```

The command:

1. Copies the project to a temporary directory, skipping generated and test
   directories.
2. Fails if any `DEBUG = true` assignment is found in the copied Lua sources.
3. Removes lines matching `^\s*dlog\s*\(` from `.lua` files and from inline
   `__lua__` sections of the entry cartridge.
4. Warns about direct `printh(` calls outside the `dlog` wrapper.
5. Builds from the temporary directory and writes `dist/<rom>.rom` (or the
   path passed with `--out`).
6. Deletes the temporary directory.

The source tree is not modified. Keep every `dlog()` call on one line; a
multi-line call leaves broken Lua behind and the release build will fail.

If a project has `dlog()` calls but no `DEBUG` assignment, the build warns. Set
`DEBUG = false` explicitly so the intent is clear.

After stripping, boot the release ROM and exercise the main path. A line that
was removed should have been diagnostic only; if behavior changes, it had a
side effect and must be refactored.

The wrapper function itself can remain in the release source. It is tiny and
unreferenced once the calls are gone. If ROM size matters, remove the definition
as well.

## Remove debug overlays

- `statctl('dfps', 1)` enables a global FPS/CPU overlay. It persists across
  cartridge switches, so it may still be on after a reload.
- Disable it with `statctl('dfps', 0)`, or never enable it in release code.
- Gate any custom diagnostic screen behind `DEBUG` or a user-facing settings
  flag. Do not leave raw counters on the main screen.

## Size and performance

- Debug and release builds both default to `dist/<rom>.rom`; use
  `build --out <file>` or `build --release --out <file>` for a custom path.
- The cartridge source is embedded and compressed, so `strings` may not reveal
  debug text. Compare debug and release sizes and test behavior instead of
  relying on string searches.
- `stat(0)` reports memory use in KB; `stat(7)` reports FPS. Measure after
  removing overlays.
- Large assets belong in `#blob :z:` or a compressed audio form. Check the
  target spec's ROM limit before adding assets.

## Versioning

Bump a version constant whenever the bytes on the wire, a save format, or a
persisted configuration change:

```lua
PROTO_VER = 1
SAVE_VER = 1
```

- Include the version in the packet header or file header.
- Reject unknown versions with a clear diagnostic, or migrate older data
  deliberately.
- Update all peers, devices, or instances that exchange the format together.
  An old peer that silently ignores new packets looks like "no peers" rather
  than a version error.
- Document the compatibility rule in the project README.

## Release checklist

- [ ] `DEBUG` is `false`.
- [ ] No direct `printh(` warnings outside the wrapper.
- [ ] `build --release` succeeds.
- [ ] The release ROM boots and the main path works.
- [ ] At least one fallback path works (missing module/permission, no peer, old
      data).
- [ ] `logs --grep ERROR` shows no unexpected errors.
- [ ] Key screens have a screenshot or golden md5.
- [ ] `statctl('dfps')` is off.
- [ ] Protocol, save, and configuration versions are bumped when needed.
- [ ] All participants have the same protocol version.
- [ ] README and controls are up to date.
- [ ] The ROM fits the target spec.

## Pitfalls

- Shipping with `DEBUG = true` because only the debug build was tested.
- Calling `printh` directly: the release build warns, but only `dlog` lines are
  stripped automatically.
- Splitting a `dlog` call across lines; the release pass removes only the first
  line and leaves invalid Lua.
- Forgetting that `dfps` persists across cartridge switches.
- Changing a packet or save layout without bumping the version.
- Testing only the debug build; the release build has different code and size.
- Assuming a compressed ROM can be audited with `strings`; test it instead.
