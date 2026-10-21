# coloX cartridge cheat sheet

Condensed from the official documentation (29 articles, cached under
`~/.cache/clx-dev/docs/<lang>/guide/`). Use `docs <query>` to search the full text.

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
print(str, x, y [, col [, opt [, size [, font]]]])
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
statctl('dfps', 1) -- debug FPS/CPU overlay; remove before release

sfx(n [, channel [, offset]])
music(n [, fade_len [, channel_mask]])
usemod('vg' | 'b2d' | 'net' | 'rlottie')
```

Colors: `black`, `dark_blue`, `dark_purple`, `dark_green`, `brown`,
`dark_gray`, `light_gray`, `white`, `red`, `orange`, `yellow`, `green`,
`blue`, `indigo`, `pink`, `peach`. In 16/32bpp modes use
`getcolor(r, g, b)` or `palrgb(r, g, b, a)`.

## Toolchain

```bash
# Build (the -d argument MUST end with a slash, and -b comes after -r)
coloXtool -d <project-root>/ -r mygame.clx -b dist/mygame.rom

# Run and open the debug channel on 127.0.0.1:3563
coloXtool -d <project-root>/ -r mygame.clx
```

`coloXtool -b` also writes `<entry>.clx.rom` next to the entry; the build command
in this skill removes that duplicate.

## Pitfalls

- A missing trailing slash in `-d` produces a path like `.../projectmygame.clx`.
- `#png` replaces the whole `__gfx__` section, so do not mix it with hex data.
- 4bpp specs use the fixed 16-color palette; `getcolor()` values only make sense
  in 16/32bpp specs.
- ROM size is enforced at load time; check `platforms.md` for the limit.
- `version` in the header must be supported by the runtime; `stat(5)` reports it.
