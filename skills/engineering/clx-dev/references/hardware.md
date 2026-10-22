# ColoPLAY hardware notes

Firmware-derived and real-device notes for cartridges that use the four corner
buttons, the knob, or the visible lamps. The official coloX API documents
`btn()` and `svcreq("ex", ...)`; it does not document the physical corner
layout, the knob's event behavior, the lamp arrangement, or which hardware
revisions actually have lamps populated.

Use this file when designing input for a button/knob ColoPLAY, sending
`templed`/`led` commands, or bringing a ROM to a hardware revision for the
first time.

## Hardware revisions

The source audit covers the three button/knob firmware trees named below.
“Firmware driver” means the tree compiles and initializes an SK6812/quantum
LED path; it does not prove that a particular chassis has LEDs mounted.

| Firmware tree / target | Input | Firmware LED path | Physical lamps |
| --- | --- | --- | --- |
| `coloplay` / ESP32-S3 | Four corner buttons + knob | Yes: 14-pixel quantum buffer, data GPIO48, power/control GPIO8 (`LEDCTL_PIN`) | Present on the real device audited; both the corner-button lamps and the knob ring were visible. |
| `coloplayp4` / ESP32-P4 | Four corner buttons + knob | Yes: same 14-pixel quantum path, data GPIO48, power/control GPIO23 | Not device-verified; check the first physical unit. |
| `coloplays31` / ESP32-S31 | Four corner buttons + knob | Yes in firmware: 14-pixel quantum path, data GPIO53, power/control GPIO52 | **The known S31 unit has no physical lamps.** The service can accept commands even though nothing is visible. |
| ColoPLAY V2 (`coloX-16C`) | Touch screen, no corner buttons/knob | Not covered by these button/knob firmware trees | Use `touch()` and the V2 layout; do not assume this page's lamp behavior. |

Source-audit evidence used by the table:

- Each button/knob tree enables `CONFIG_NODEMCU_CMODULE_AI` and
  `CONFIG_NODEMCU_CMODULE_QUANTUM`.
- Stock bootstrap creates `_G.buffer = qt.new(14)` in `epfrm/init.lua`.
- `components/modules/quantum.c` caps the physical output at
  `LED_MAX_NBER_LEDS 14` and uses the data GPIO listed above.
- `components/lslib/app_common.c` defines the corresponding `LEDCTL_PIN`.
- `components/platform/include/platform.h` chooses `ColoPLAY0/1/2.ver` from
  screen macros, not from the SoC target.

Do not infer lamp presence or CPU/firmware target from `$sys.model`. The model
string identifies a screen/firmware package (for example `ColoPLAY0.ver`,
`ColoPLAY1.ver`, `ColoPLAY2.ver`); P4 and S31 builds reuse those model names.
Likewise, a successful `svcreq("ex", "templed:...")` only means the service
accepted the command; it does not prove that visible lamp hardware exists.
Know the deployment target before making lamps part of the design, or ask the
user which hardware revision will run the ROM.

## Physical input mapping

The mapping is shared by the ESP32-S3, P4, and S31 button/knob firmware paths
and was confirmed on a real ESP32-S3 device:

| Physical control | Cartridge API | Simulator injection | Use |
| --- | --- | --- | --- |
| Top-left button | `btn(0)` / `btnp(0)` | `btn X` | Tap only. |
| Top-right button | `btn(1)` / `btnp(1)` | `btn Y` | Tap or hold. |
| Bottom-left button | `btn(2)` / `btnp(2)` | `btn A` | Tap or hold. |
| Bottom-right button | `btn(3)` / `btnp(3)` | `btn B` | Tap or hold. |
| Knob press | `btn(4)` / `btnp(4)` | `btn CENTER` | Tap or confirm. |
| Knob one detent left | `btnp(5)` pulse | `btn LEFT` | Accumulate as a delta. |
| Knob one detent right | `btnp(6)` pulse | `btn RIGHT` | Accumulate as a delta. |
| System/reserved key | `btn(7)` / `btnp(7)` | `btn SYS` | Do not use for gameplay. |

Design rules:

- Keep long-press gameplay on TR/BL/BR (`btn(1/2/3)`). The top-left long press
  is reserved by the host and can leave or sleep the cartridge.
- Treat the knob as a stream of detent events, not an absolute angle or
  position. A small handler is usually:
  ```lua
  Input.knob = 0
  if btnp(5) then Input.knob = Input.knob - 1 end
  if btnp(6) then Input.knob = Input.knob + 1 end
  ```
- The firmware source maps encoder phase A (`EAS`) to button 5 and phase B
  (`EBS`) to button 6. If a future device feels reversed, test both detents on
  hardware before hard-coding on-screen direction words.
- On round 240×240 screens, keep decisive UI inside the circle. Corners clip;
  verify with screenshots rather than trusting the rectangular canvas.

## Lamp service (“keylamp”)

The stock UI calls this subsystem the “keylamp”, but on lamp-equipped ColoPLAY
hardware it covers both visible lamp areas:

- lamps associated with the four corner buttons, and
- the ring around the central knob.

The cartridge-facing `ex` service exposes only two global channels. It does not
expose “button lamps” and “knob ring” as separate targets, and it has no
documented per-button or per-pixel addressing. Internally the stock firmware
creates one 14-pixel quantum/SK6812 buffer (`qt.new(14)` and
`LED_MAX_NBER_LEDS 14`) for the combined assembly. The source does not publish
how those 14 pixels map onto the physical button/ring layout. Treat `templed`
as whole-device mood lighting, not as precise control of either area.

The stock BIOS implementation uses internal globals/modules such as `qt`, `ai`,
`md`, and `lirgb`. They are not exposed through cartridge `usemod()`; do not
design a ROM around calling them directly. Use the documented `ex` service
below.

The `ex` service has two command families with the same syntax:

```lua
-- Temporary lamp state: preferred by cartridges.
svcreq("ex", "templed:idx:type:value")

-- Persistent user key-lamp configuration: avoid in games.
svcreq("ex", "led:idx:type:value")
```

`led` saves the state into the user's system configuration. `templed` applies
the state without saving. A game should therefore send `templed`; sending `led`
can leave the player's menu lighting changed after the ROM exits.

All three fields are parsed as hexadecimal. Write them with `0x` prefixes or
`string.format("%02x"/"%06x")`; do not send decimal-looking values unless they
are intended as hex.

Known useful commands on lamp-equipped hardware:

```lua
-- Global brightness channel. Stock firmware exposes brightness values 5..100.
svcreq("ex", "templed:1:0xcf:" .. string.format("%02x", 30))

-- Global color/effect channel. Values below 0x01000000 are static RGB.
svcreq("ex", "templed:2:0xff:0x00ffb36c")
```

`idx1` is a global brightness channel and `idx2` is a global color/effect
channel. There is no documented cartridge API for individual button lamps,
lamp rings, pixels, or for discovering which physical lamp group an index
drives. Use global mood lighting rather than per-button affordances.

### Queue and firmware pulses

The firmware's lamp command queue has only two slots and pushes without
waiting. Extra commands are silently dropped, and `svcreq` can still return
successfully. Follow these rules:

- Send at most one lamp command every 4–6 frames.
- Queue the final desired mood state, not a per-frame animation stream.
- Coalesce rapid state changes and send only the latest state.
- A failed/missing visible reaction is not an error the cartridge can query.

While a physical button is held, firmware also enqueues its own key-lamp pulse
approximately every 0.9 seconds (`idx=2`, `ty=0xff`, high byte `0x0f`). This can
temporarily interrupt a game's static color or effect. Treat it as expected
host behavior; do not try to cancel it from Lua.

On the known lamp-less S31 unit, skip this entire section: the service path
exists in firmware, but there is no physical lamp to display.

## Stock color and effect values

These `idx2` values come from the stock key-lamp menu. Static colors are the
portable subset; animation words are firmware-specific and should be verified
on the target unit before shipping.

Static colors:

| Value | Color |
| --- | --- |
| `0x00ff0000` | Red |
| `0x0000ff00` | Green |
| `0x000000ff` | Blue |
| `0x00ffff00` | Yellow |
| `0x00ff00ff` | Magenta |
| `0x0000ffff` | Cyan |
| `0x00ffffff` | White |

Stock animation slots:

```text
0x068b0c00
0x05990c00
0x03bc0e90
0x01810f00
0x01bd0c00
```

The stock UI calls these “effect 1” through “effect 5”; their visual meaning is
not part of the cartridge API. Prefer static `0x00RRGGBB` colors unless the
exact firmware and hardware have been checked.

## Hardware bring-up checklist

Run this when a ROM first meets a new physical device:

1. Record the actual hardware/firmware target from the device label or user;
   do not infer it from `$sys.model` alone.
2. Confirm the corner mapping by asking the user to tap TL/TR/BL/BR and
   displaying `btn(0..3)`.
3. Confirm knob press and both rotation directions as `btn(4/5/6)`.
4. Verify long-press gameplay only on TR/BL/BR; never require a TL hold.
5. On lamp-equipped hardware, test one dim `templed` color and brightness.
   Watch both the corner-button lamps and the knob ring, then confirm the
   user's normal key-lamp setting returns after exit.
6. On the lamp-less S31 unit, verify the game remains understandable with all
   lamp calls disabled.
7. Initialize `wave('I')`, play a short PCM chunk, and check level/latency.
8. Check round-screen clipping and the readability of every text-heavy screen.
9. Restart the device and confirm `cartdata()` data survived.
10. Watch the host/simulator logs for service or runtime errors after the run.
