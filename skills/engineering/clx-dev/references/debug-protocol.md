# coloX debug protocol (port 3563)

The simulator exposes a line-based text protocol on `127.0.0.1:3563`. It is a
host-side developer channel, not a cartridge API. The desktop build enables it;
retail firmware usually does not.

Responses are framed:

```text
>-> btn
btn inj=0x20 [LEFT ] left=-1
<-< btn
```

Commands are processed at frame boundaries. Input injection is frame-accurate:
it lands after the frame's real input and before the cartridge calls `btn()`.

## Multiple VMs

The BIOS menu VM and the cartridge VM share the port. The first VM to start
claims the channel; list and select to target a specific one:

```text
vmlist
# idx  cart            frame  target
# 0    play_menu.clx   1234
# 1    mygame.clx      567    *
vm 1
```

When the target VM is destroyed (cartridge switch), the channel is released and
the next VM claims it.

## Lua debugging

| Command | Purpose |
| --- | --- |
| `bt` | Call stack |
| `b <file:line \| func> [if cond]` | Breakpoint |
| `i b` / `i local` | List breakpoints / locals and upvalues |
| `n` / `s` / `fin` / `c` / `pause` | Step over / into / out / continue / pause |
| `l [width]` | List source |
| `src [file]` | List source files or print one |
| `p <expr>` | Print an expression (`[var]` reads an upvalue) |
| `set <var=value>` | Assign |
| `r <code>` | Run code in the stopped frame |
| `f <level>` | Select a stack frame |
| `dis` / `en` / `d` | Disable / enable / delete breakpoints |
| `u` | Refresh the screen while stopped |

## Test automation

### Buttons

```text
btn <keys...> [duration]   # keys: X Y A B CENTER LEFT RIGHT SYS
btn 0                      # stop injecting
btn                        # query current state
```

A bare number is frames; a number with `ms` is milliseconds; omitting the
duration holds until `btn 0`.

```text
btn LEFT A 30
btn LEFT 500ms
btn SYS 1
```

### Gamepad

```text
padset <player> <keys...> [duration]
padset <player> 0
padset
```

Keys use the `pad` module names (`A B X Y L R L2 R2 L3 R3 UP DOWN LEFT RIGHT
SELECT START MENU`). Sticks stay centered. Works on builds with gamepad support.

### Mouse, touch, keyboard

```text
mouse <x> <y> [buttons] [duration]
mouse 0
mouse
key <name> [duration]
key 0
key
```

Coordinates are cartridge VM coordinates. Bit 0 of `buttons` is left/touch down.

### Screenshot

```text
shot [path]
```

Defaults to `coloX_shot_<frame>.bmp` in the working directory. The response
includes the pixel md5, which is stable across platforms for the same frame:

```text
shot: /tmp/a.bmp 480x480 bpp=4 md5=5f2a...c901 frame=1234
```

Use the md5 for golden-image tests instead of reading the BMP.

### Input state

```text
input?
```

Prints frame/FPS/cart, button state (real + injected), mouse, keyboard, and both
gamepad slots.

## Session example

```text
vmlist
vm 1
btn RIGHT 90
shot /tmp/menu_open.bmp
mouse 240 120 1 15
btn 0
input?
```

`clx-dev` wraps this protocol: `debug --cmd "vmlist"` for one command,
`debug` for a REPL, and `shot` for screenshot + md5 comparison.
