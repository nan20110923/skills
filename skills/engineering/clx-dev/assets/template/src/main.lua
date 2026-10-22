-- Entry module for a coloX cartridge.
-- Loaded from the cartridge through "#include src/main.lua".

-- Debug output goes to the host log, not the screen. Set DEBUG to true while
-- developing. `build --release` expects false and strips single-line dlog()
-- calls from a temporary copy of the project.
DEBUG = false

function dlog(fmt, ...)
  if not DEBUG then return end
  local ok, s = pcall(string.format, fmt, ...)
  printh(ok and s or tostring(fmt))
end

function _init()
  x = __vm_width / 2
  y = __vm_height / 2
  dlog("init: %dx%d", __vm_width, __vm_height)
end

function _update()
  if btn(0) then y = y - 2 end
  if btn(1) then y = y + 2 end
  if btn(2) then x = x - 2 end
  if btn(3) then x = x + 2 end

  -- ColoPLAY V2 has a touch screen and no buttons. Replace the block above with:
  -- local tx, ty, down = touch()
  -- if down then x, y = tx, ty end
end

function _draw()
  cls(black)
  circfill(x, y, 6, red)
  print("hello coloX", 8, 8, white)
  print("fps " .. stat(7), 8, 20, light_gray)
end
