# coloX audio

Playback, microphone capture, codecs, embedded audio, and streaming. Use this
with `docs wave`, `docs micpoll`, and `docs statctl` for the full official text.

## Audio types

`audiotype` is an API-level type, not a wire-protocol codec id. If audio is sent
over a network or stored in a file, define your own codec byte and keep the
mapping explicit.

| ID | Type | Notes |
| --- | --- | --- |
| 0 | PCM, 16-bit little-endian | Lowest CPU cost, largest data |
| 1 | ADPCM | 4:1 compression; 2 samples per input byte |
| 2 | G.711A | 2:1 compression |
| 3 | Opus | High compression; firmware must support it |

## Playback: `wave`

```lua
wave(data [, from, to, audiotype [, hz [, bpp]]])
```

- `from` / `to` are 1-based byte positions; `to` defaults to `#data`.
- `hz` accepts only `0` (default 16000) or `16000`; `bpp` accepts only `0`
  (default 16) or `16`. Other values reject the call and return `0`.
- The call returns `produced, consumed`. `consumed` is the number of input
  bytes actually accepted. If `consumed < #data`, keep the remainder for the
  next call.
- `produced` is bytes for PCM and a sample count for ADPCM/G.711A. For any
  codec, `wave('L')` is the reliable buffered-byte count.

Special data values:

| Value | Meaning |
| --- | --- |
| `wave('I')` | Initialize playback resources |
| `wave('R')` | Reset the playback buffer |
| `wave('D')` | Release playback resources |
| `wave('L')` | Bytes currently buffered for playback |
| `wave()` | Bytes of remaining writable space |

Stream only when there is room:

```lua
wave('I')
local pos = 1

function _update()
  if pos <= #pcm and wave() >= 640 then
    local chunk = string.sub(pcm, pos, pos + 639)
    local _produced, consumed = wave(chunk)
    pos = pos + (consumed or 0)
  end
end
```

Call `wave('I')` once before streaming and `wave('D')` when finished. Do not
call `wave('I')` or `wave('R')` from the debugger while the VM is paused; see
[simulator-debugging.md](simulator-debugging.md).

## Capture: `micpoll`

Enable microphone capture before polling and check the result. The module name
is `mic` on current firmware:

```lua
local ok, enabled = pcall(function() return usemod('mic') end)
local mic_ok = ok and enabled == true
```

`micpoll([flag, maxlen, audiotype])`:

| Flag | Meaning |
| --- | --- |
| `1` | Clear the capture buffer |
| `2` | Return the valid data length in 16-bit units |
| `3` | Read data; `maxlen` is the maximum amount in 16-bit units |
| `4` | Return FFT data |

For mono 16-bit PCM, one 16-bit unit is one sample (two bytes). Flag `2`
reports buffered **input** units, independent of the output codec. Flag `3`
returns a string; for compressed types the encoded result is usually much
smaller than `maxlen * 2` bytes.

```lua
local units = micpoll(2) or 0
if units >= 320 then
  local chunk = micpoll(3, 320, 0) -- up to 320 input units, PCM
  if chunk and #chunk > 0 then
    -- process or play chunk
  end
end
```

- Clear with `micpoll(1)` and wait for fresh data before encoding. Clearing and
  immediately reading can return stale or garbage data in the simulator.
- The official example uses `micpoll(nil, nil, type)` as a read; explicit flag
  `3` is clearer when `maxlen` matters.
- `micpoll(4, count)` returns `avg, maxidx, maxval, ffts`; `count` is the number
  of FFT samples (`0` omits the array).
- The simulator may capture silence if the host has not granted microphone
  permission to the simulator. A successful `usemod('mic')` does not prove that
  the signal is non-silent.

## Opus

Opus support depends on the firmware. Probe it instead of assuming:

```lua
local ok, frame_ms = pcall(function()
  statctl('oers', 16000)
  statctl('oedm', 20)
  statctl('oebt', 24000)
  statctl('odrs', 16000)
  statctl('oddm', 20)
  statctl('orst')
  return statctl('oedm')
end)
local opus_ok = ok and frame_ms == 20
```

Encoder keys (`oeXX`) and decoder keys (`odXX`) are independent:

| Key | Meaning | Values | Default |
| --- | --- | --- | --- |
| `oers` | Encoder sample rate | 8000 / 12000 / 16000 / 24000 / 48000 | 16000 |
| `oedm` | Encoder frame duration (ms) | 5 / 10 / 20 / 40 / 60 | 60 |
| `oebt` | Encoder bitrate | `0` = auto, otherwise bits/s | 0 |
| `oecp` | Encoder complexity | 0-10 | 6 |
| `oeap` | Encoder application | 0 = VOIP, 1 = AUDIO, 2 = LOWDELAY | 0 |
| `odrs` | Decoder sample rate | same as `oers` | 16000 |
| `oddm` | Decoder frame duration (ms) | 5 / 10 / 20 / 40 / 60 | 60 |

Changes apply to the next lazily created codec. Call `statctl('orst')` after
changing settings to recreate existing codecs; `orst` with `0` resets the
encoder only and `1` resets the decoder only. Set encoder and decoder to the
same sample rate and frame duration, then query the value back.

### Opus framing

Opus payloads passed to `wave()` are framed as a sequence of:

```text
[u16 big-endian packet length][Opus packet]
```

- `micpoll(3, ..., 3)` returns this framing. One call can contain several
  packets; split on the two-byte length when you need per-packet boundaries.
- `wave(data, nil, nil, 3)` expects the same framing. A raw Opus packet without
  the length prefix is not accepted (`produced=0, consumed=0` in practice).
- The decoder stops at an incomplete trailing packet. If `consumed < #data`,
  keep the tail and retry after more bytes arrive.
- A 20 ms frame at 16 kHz is 320 samples. At 24 kbps it is roughly 60 bytes;
  silence packets can be much smaller (around 10 bytes), so packet size is only
  a rough activity signal.

### Compile-time Opus

`#blob :o:` uses the compile-time Opus encoder documented as 16 kHz with 60 ms
frames. Runtime `statctl` settings do not change that encoder. If a different
frame size is required, encode at runtime with `micpoll`, or ship PCM/ADPCM.

## Embedded audio: `#blob`

```lua
local one =
#blob :z:1 assets/data.bin

local pcm =
#blob assets/voice.pcm

local chunks = {
#blob :oa:9600: assets/voice.pcm
}
```

| Prefix | Encoding |
| --- | --- |
| `z` | zlib |
| `e` | ADPCM |
| `g` | G.711A |
| `o` | Opus |
| `za`, `ea`, `ga`, `oa` | Chunked form; returns an array of strings |

For audio chunking, the number after the prefix is the size of the **raw PCM
input** in bytes, not samples and not encoded bytes. At 16 kHz / 16-bit mono:

- 1920 bytes = 60 ms
- 9600 bytes = 300 ms (five 60 ms frames)
- 960 bytes = 30 ms; too short for some encoders and can fail with an encode
  error

Use a chunk size that is a multiple of the frame's raw size. Whole-file forms
return one string; chunked forms return an array, which is convenient for
streaming.

`#blob` paths are compile-time and resolve relative to the workspace. There is
no runtime filesystem. Use `#include` for Lua source files, not `require`.

## Streaming pattern

A small producer/consumer queue is enough for most audio streamers:

1. Producer: capture with `micpoll`, read a `#blob` chunk, or receive bytes.
2. Queue frames with a sequence number and a timestamp.
3. Consumer: feed `wave()` only when `wave()` reports enough free space.
4. Keep any `consumed` remainder at the head of the queue; do not drop a
   partial packet.
5. Prebuffer a few frames to absorb scheduling jitter. Too small causes
   underruns; too large adds latency.
6. On underrun, feed silence rather than leaving stale audio.

Measure latency with `time()` or `stat(12)` (milliseconds since boot). Do not
infer real-device latency from simulator FPS.

## Pitfalls

- `print` draws on screen. `printh` writes to the host log. Never use `print`
  for diagnostics.
- `wave('L')` is buffered bytes, not frames or milliseconds.
- `micpoll(2)` and `micpoll(3)` use 16-bit units, not bytes.
- Audiotype `3` means Opus. A protocol codec id of `1` does not mean Opus; keep
  the two namespaces separate.
- `#blob :oa:<n>` uses raw PCM input bytes. A 960-byte chunk is not 960 output
  bytes.
- `statctl` changes need `orst` before they affect an existing codec.
- Encoder and decoder sample rates and frame durations must match.
- Raw Opus packets need the two-byte big-endian length prefix.
- Do not call `wave('I')` or `wave('R')` from the paused debugger.
- The simulator microphone can be silent because of host permissions; do not
  treat silence as a codec bug.

## Verification

Use a probe cartridge for repeatable checks; see
[simulator-debugging.md](simulator-debugging.md). A useful sequence is:

1. Enable the microphone module and print the result.
2. Print `micpoll(2)` units for a few frames.
3. Capture one frame with `micpoll(3, frame_samples, 3)`.
4. Split and print the Opus packet sizes.
5. Decode with `wave(chunk, nil, nil, 3)` and print `produced, consumed`.
6. Check `wave('L')` and `wave()` before and after playback.

For deterministic playback tests, generate a PCM tone or load a known PCM
file; do not depend on the host microphone.
