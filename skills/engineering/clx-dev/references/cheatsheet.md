# coloX cartridge cheat sheet

Condensed from the official documentation (29 articles, cached under
`~/.cache/clx-dev/docs/<lang>/guide/`) and verified development notes. Use
`docs <query>` to search the full text.

## Target hardware

| Device | Max spec | Screen | Input |
| --- | --- | --- | --- |
| ColoPLAY | `coloX-16` | 240×240 round | Buttons |
| ColoPLAY V2 | `coloX-16C` | 480×480 round | Touch, no buttons |

Common specs: `coloX-4P` (128×128, 4bpp), `coloX-4` / `coloX-16` (240×240),
`coloX-4C` / `coloX-16C` / `coloX-32C` (480×480), `coloX-16L` (480×800),
`coloX-16W` (800×480). Custom: `X-<width>x<height>_<bpp>`.
A cartridge cannot exceed its spec's ROM limit; `coloX-16` is about 184 KB.

## File format

A `.clx` file is plain text:

```text
coloX-16
version 1
style:game
name:mygame
author:me
desc:

__lua__
#include src/main.lua

__gfx__

__gff__

__map__

__sfx__

__music__
```

- Line 1 is the spec. `version N` is optional and must not exceed the runtime.
- Sections start with `__name__`; separate them with blank lines.
- `__lua__` code, `__svc__` background service, `__gfx__` sprites,
  `__pal__` palette, `__gff__` sprite flags, `__map__` map, `__sfx__` sound
  effects, `__music__` music.

## Preprocessor directives

```lua
#include my_utils.lua          -- inline another Lua file
local img = #blob temp.png     -- embed a file as a Lua string
local data = #blob :z:1 temp.bin
```

```text
__gfx__
#png png/bg.png               -- import a PNG sprite sheet; other gfx data is ignored
```

`#blob` compression prefixes: `z` zlib, `e` ADPCM, `g` G.711A, `o` Opus.
`#include` paths resolve relative to the workspace passed to `coloXtool -d`.

## Lifecycle

```lua
function _init() end          -- once after load
function _update() end        -- every frame while active
function _draw() end          -- after _update when the canvas is refreshed
function _idle_update() end   -- every frame while idle
function _idle_draw() end
function _cfg_update() end    -- configuration screen
function _cfg_draw() end
function _initsvc() end       -- loaded as a background service
function _updatesvc() end
function _svcind(seq, name, path) end
function _setstat(stat, statname) end
```

## Common API

```lua
cls([col])
print(str, x, y [, col [, opt [, size [, font]]]]) -- draws on screen
printh(...)                                        -- writes to the host log
rectfill(x0, y0, x1, y1 [, col])
circfill(x, y, r [, col])
spr(n, x, y [, w, h [, flip_x, flip_y]])
map(tile_x, tile_y [, sx, sy [, tile_w, tile_h [, layers]]])

btn([b]) -> boolean | bitmask    -- 0 up, 1 down, 2 left, 3 right
btnp([b]) -> boolean | bitmask
touch() -> x, y, stat, hotid, rectidx, abort

stat(0)  -- memory use (KB)
stat(5)  -- platform version (currently 14)
stat(7)  -- current FPS
statctl('dfps', 1) -- debug FPS/CPU overlay; off for release
statctl('oedm', 20) -- Opus frame duration; see audio.md for all keys

sfx(n [, channel [, offset]])
music(n [, fade_len [, channel_mask]])
usemod('vg' | 'b2d' | 'net' | 'mic' | 'rlottie')
```

Colors: `black`, `dark_blue`, `dark_purple`, `dark_green`, `brown`,
`dark_gray`, `light_gray`, `white`, `red`, `orange`, `yellow`, `green`,
`blue`, `indigo`, `pink`, `peach`. In 16/32bpp modes use
`getcolor(r, g, b)` or `palrgb(r, g, b, a)`.

## Audio quick reference

```lua
usemod('mic')                       -- enable capture; check the result
local units = micpoll(2)            -- buffered input, 16-bit units
local pcm = micpoll(3, 320, 0)      -- read up to 320 units, PCM
wave(pcm, nil, nil, 0)              -- play PCM
wave('I'); wave('R'); wave('D')     -- init / reset / release
wave('L')                           -- bytes buffered
wave()                              -- bytes of free space
```

Audiotype: `0` PCM, `1` ADPCM, `2` G.711A, `3` Opus. This is not a
wire-protocol codec id. Opus data is framed as
`[u16 big-endian length][packet]`; keep packet boundaries. `#blob :oa:<n>` uses
`n` raw PCM input bytes. See `audio.md`.

## Network quick reference

```lua
usemod('net')
local sock, err = net_bind("udp", "0.0.0.0", 9000)
local data, addr, port = sock:recvfrom(1200)
if data then sock:sendto(data, addr, port) end
```

`recvfrom` is nonblocking; drain until `false`. Keep datagrams small. Use
`string.pack` with an explicit endianness and a version byte. See `network.md`.

## Binary data and Lua

```lua
local hdr = string.pack("<c2 B I2 I2", "PX", 1, seq, len)
local magic, ver, seq, len, pos = string.unpack("<c2 B I2 I2", hdr)
```

- coloX uses 32-bit integers and 32-bit floats.
- Use `<` or `>` explicitly for wire formats; avoid `=`.
- `#include` inlines Lua source; `require` only works for preloaded modules
  such as `cjson`/`cjson_safe`.

## Debug logging

```lua
DEBUG = false
function dlog(fmt, ...)
  if not DEBUG then return end
  local ok, s = pcall(string.format, fmt, ...)
  printh(ok and s or tostring(fmt))
end
```

Keep `dlog(...)` calls on their own line. `build --release` expects
`DEBUG = false`, strips those lines, and warns about direct `printh`. See
`release.md`.

## Toolchain

```bash
# The wrapper handles the -d trailing slash and the -b ordering.
node <skill-dir>/scripts/clx.mjs build
node <skill-dir>/scripts/clx.mjs build --release
node <skill-dir>/scripts/clx.mjs run
node <skill-dir>/scripts/clx.mjs probe --root test/probe
node <skill-dir>/scripts/clx.mjs logs --grep ERROR
node <skill-dir>/scripts/clx.mjs debug --batch test/debug.txt
```

`build` writes `dist/<rom>.rom`; `build --release` strips `dlog()` lines from a
temporary copy. `probe` waits for `probe: done` (or `--until`) and stops the
simulator; `debug --batch` reads a project-relative command file. The wrapper
removes the duplicate `<entry>.clx.rom` sidecar. Prefer the wrapper over calling
`coloXtool` directly.

## Pitfalls

- `print` draws on screen; `printh` writes to the host log. Do not mix them up.
- Audiotype `3` is Opus. A protocol codec id is your own mapping; keep it
  separate from the API audiotype.
- `micpoll(2)` and `micpoll(3)` use 16-bit units, not bytes. `#blob :oa:<n>`
  uses raw PCM input bytes, not encoded bytes or samples.
- `statctl` audio changes need `orst` before they affect an existing codec.
- `recvfrom` is nonblocking; drain it until `false`. `net_getinf` is not
  available on every target.
- Keep UDP datagrams small and use an explicit endianness in `string.pack`.
- `statctl('dfps')` persists across cartridge switches; turn it off for release.
- If you call `coloXtool` directly, a missing trailing slash in `-d` produces a
  path like `.../projectmygame.clx`. Prefer the wrapper.
- `#png` replaces the whole `__gfx__` section, so do not mix it with hex data.
- 4bpp specs use the fixed 16-color palette; `getcolor()` values only make sense
  in 16/32bpp specs.
- ROM size is enforced at load time; check `platforms.md` for the limit.
- `version` in the header must be supported by the runtime; `stat(5)` reports it.
