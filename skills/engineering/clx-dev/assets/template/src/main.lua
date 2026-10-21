-- Entry module for a coloX cartridge.
-- Loaded from the cartridge through "#include src/main.lua".

function _init()
  x = __vm_width / 2
  y = __vm_height / 2
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
