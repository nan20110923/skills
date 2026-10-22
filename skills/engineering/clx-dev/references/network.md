# coloX networking

Sockets, local discovery, binary protocols, and host-side test peers. The
official `net` module also provides TCP, HTTP, WebSocket, DNS, and the Copas
scheduler; use `docs net` for the complete API.

## Enable the module

```lua
local ok, enabled = pcall(function() return usemod('net') end)
net_ok = ok and enabled == true
```

`usemod('net')` returns `true` on success. If the module is unavailable, the
cartridge should keep running and disable network features instead of erroring
every frame.

Copas is defined in `colox_net.lua`; load it with `#include colox_net.lua`
after `usemod('net')` and call `copas.step()` once per frame. Raw sockets do
not need Copas; `recvfrom` is nonblocking.

## Bind a socket

```lua
local sock, err = net_bind("udp", "0.0.0.0", 9000)
if not sock then
  printh("bind failed:", err)
end
```

`net_bind([type], [addr], port [, backlog])` returns a socket or `nil, err`.
The common types are:

| Type | Use |
| --- | --- |
| `"udp"` | Datagrams, broadcasts, local discovery |
| `"mcast"` | Multicast; also enables broadcast on IPv4 |
| `"tcp"` | Streams, HTTP, WebSocket |

UDP does not need `listen()`. For TCP servers, call `accept()` after binding.
If the preferred port is busy, try a small range and record the port that
succeeded. A fixed port is easier for peers to find; a range is more robust on
crowded networks.

## UDP send and receive

```lua
local data, addr, port = sock:recvfrom(1200)
if data then
  -- data is a string; addr and port identify the sender
  sock:sendto(data, addr, port)
end
```

- `sock:recvfrom([size])` is nonblocking. It returns `data, addr, port` on
  success, `false` when there is no datagram, or `nil, err` on failure. Drain it
  in a loop until `false`.
- `sock:sendto(data, addr, port)` returns the number of bytes sent, `false` on
  timeout, or `nil, err`.
- Reply to the `addr, port` returned by `recvfrom`, not to the destination port
  you sent to. This is what lets a peer behind a different source port reply.
- Keep datagrams small. A payload around 1200 bytes or less is a safe ceiling
  for typical LAN/Wi-Fi paths; larger datagrams risk fragmentation.
- `sock:close()` when the socket is no longer needed.

## Local addresses

```lua
local ok, inf = pcall(function() return net_getinf() end)
if ok and inf then
  for _, iface in ipairs(inf) do
    if iface.family == "inet" and iface.addr then
      -- iface.name, iface.addr, iface.mask
    end
  end
end
```

`net_getinf()` returns an array of `{name, family, addr, mask}` entries or
`nil, err`. It is not implemented on every target (for example, some embedded
builds return an error), so guard it with `pcall` and fall back to a configured
address.

To derive a subnet broadcast address, combine `addr` and `mask` when the mask
is available. If it is not, the limited broadcast address
`255.255.255.255` is a common fallback.

## Discovery pattern

A LAN cartridge usually needs three things: find peers, remember them, and
expire them.

1. Bind a UDP or `mcast` socket on a fixed port, or a small port range.
2. Periodically send an announcement datagram to the broadcast address and/or
   to a configured peer.
3. Peers reply with a unicast datagram to the source address and port.
4. Keep a peer table keyed by a stable id; update `last_seen` on every packet.
5. Expire peers that have not been seen for a few announcement intervals.
6. Include a protocol version and a room/channel id; ignore packets for other
   rooms or versions.

Use a unique id and handle collisions by regenerating it. Do not assume
broadcast works: some networks block it, and Wi-Fi client isolation blocks
peer-to-peer traffic entirely. A configured peer address is a useful fallback.

## Binary protocols

Use `string.pack` / `string.unpack` with an explicit byte order. Do not rely on
native alignment or `=` endianness for data that crosses a process or device
boundary.

```lua
local HEADER = "<c2 B B I2 I2"
local MAGIC = "PX"
local VERSION = 1

local function pack_header(kind, seq, len)
  return string.pack(HEADER, MAGIC, VERSION, kind, seq, len)
end

local function unpack_header(data)
  local header_size = string.packsize(HEADER)
  if #data < header_size then return nil end
  local magic, version, kind, seq, len, pos =
    string.unpack(HEADER, data)
  if magic ~= MAGIC or version ~= VERSION then return nil end
  if pos + len - 1 > #data then return nil end
  return kind, seq, len, pos
end
```

- `c2` is a fixed two-byte string; `B` is one byte; `I2` is a two-byte
  unsigned integer. Use `I4` for lengths that can exceed 65535.
- `string.unpack` returns the next position after the header. Validate the
  declared length against `#data` before reading the payload.
- Put a version byte in every packet. When the layout changes, bump it and
  either reject unknown versions or send a diagnostic reply.
- Keep sequence numbers modulo 65536 and compare with wrap-safe arithmetic.
- Do not trust lengths, counts, or peer-supplied strings. Cap allocations and
  reject impossible values.
- Use `printh` for protocol diagnostics, not `print`.

## Testing with a host-side peer

A second process is the simplest way to test a network cartridge without a
second device. Node's `dgram` module is enough:

```js
import dgram from "node:dgram";

const sock = dgram.createSocket("udp4");
sock.on("message", (msg, rinfo) => {
  console.log("rx", msg.length, rinfo.address, rinfo.port);
  sock.send(msg, rinfo.port, rinfo.address);
});
sock.bind(9000, "0.0.0.0", () => console.log("peer ready"));
```

Run the cartridge in the simulator and give it the peer's address, or let the
peer listen on the port the cartridge announces to. The simulator's debug
channel (TCP 3563) is separate from the cartridge's own sockets, so both can be
used at once.

Test at least these cases:

- Announcement is sent and a reply arrives.
- A peer disappears and is expired.
- A malformed length or unknown version is ignored without crashing.
- A datagram with an unexpected source port is handled correctly.
- Broadcast fails and the configured-peer fallback still works.

For a second cartridge, use a second machine. The skill's `run` command owns a
single simulator/debug port, so two instances on one machine need separate
setups.

## Hardware checklist

- Both devices are on the same subnet and can reach each other directly.
- Wi-Fi client isolation / AP isolation is disabled for peer-to-peer traffic.
- The host firewall allows the chosen UDP or TCP port.
- The bound port is not already used by another application.
- Broadcast is permitted, or a unicast peer address is configured.
- VPNs and virtual interfaces are not capturing the traffic unexpectedly.
- Both sides use the same protocol version.

## Pitfalls

- `net_getinf()` may return an error on embedded targets; always guard it.
- `recvfrom()` is nonblocking. Call it every frame and drain until `false`.
- `sendto()` can return `false` on timeout; retry or drop deliberately.
- `"udp"` may not enable broadcast; `"mcast"` does on IPv4. Have a fallback.
- If you use Copas, forgetting `copas.step()` stalls all network I/O.
- DNS resolution can block; avoid it in timing-sensitive loops.
- A bound socket keeps the port occupied until closed or the cartridge exits.
- A version mismatch often looks like "no peers"; log a counter or diagnostic
  message while developing.
- Test on the target Wi-Fi network, not only on a desk with a loopback peer.
