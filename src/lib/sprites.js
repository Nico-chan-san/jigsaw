// Piece sprites, drawn the same way on the main thread and in sprites.worker.js: the picture cut to
// a piece's outline with a soft shadow, the plain cardboard back, and halved copies of either for
// drawing zoomed out.

// How many halved copies each sprite gets, so a sprite list is [full, 1/2, 1/4, 1/8].
export const MIPS = 3

import { longPaths } from './geometry.js'

// The shadow under a piece. In a long piece, a cell's shadow stops at the sides inside the piece,
// so it never falls on the cell next to it.
function shadow(ctx, S, sc, path, long, color) {
  ctx.shadowColor = 'rgba(0,0,0,0.32)'
  ctx.shadowBlur = S * 0.05 * sc
  ctx.fillStyle = color
  ctx.fill(long ? long.fill : path)
  ctx.shadowColor = 'transparent'
  if (!long) return
  // Everything past an inner side (out to well beyond the sprite) goes.
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  const L = S * 8
  for (const [ax, ay, bx, by, nx, ny] of long.cuts) {
    const tx = (bx - ax) / (Math.hypot(bx - ax, by - ay) || 1)
    const ty = (by - ay) / (Math.hypot(bx - ax, by - ay) || 1)
    ctx.beginPath()
    ctx.moveTo(ax - tx * L, ay - ty * L)
    ctx.lineTo(bx + tx * L, by + ty * L)
    ctx.lineTo(bx + tx * L + nx * L, by + ty * L + ny * L)
    ctx.lineTo(ax - tx * L + nx * L, ay - ty * L + ny * L)
    ctx.fill()
  }
  ctx.restore()
}

// How far a cell of a long piece reaches over its inner sides, in units of the short side, so its
// cells overlap a little and no hairline shows between them.
const GROW = 0.02

// Pixel size of every piece's sprite (they are all the same).
export function spriteSize({ w, h }, margin, sc) {
  return [Math.ceil((w + 2 * margin) * sc), Math.ceil((h + 2 * margin) * sc)]
}

// Draws piece p (from buildPuzzle) into a sprite sized canvas. image is an image or ImageBitmap of
// the whole picture.
export function drawFront(ctx, { geo, room, image, margin: m, sc }, p, path) {
  const { w, h, S } = geo
  const c = ctx.canvas
  ctx.setTransform(sc, 0, 0, sc, c.width / 2, c.height / 2)
  const long = longPaths(p, S * GROW)
  shadow(ctx, S, sc, path, long, '#777')

  ctx.save()
  ctx.clip(long ? long.fill : path)
  const k = (image.naturalWidth || image.width) / room.width
  const W = room.width
  const H = room.height
  const x0 = Math.max(0, p.cx - w / 2 - m)
  const y0 = Math.max(0, p.cy - h / 2 - m)
  const x1 = Math.min(W, p.cx + w / 2 + m)
  const y1 = Math.min(H, p.cy + h / 2 + m)
  ctx.drawImage(image, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, x0 - p.cx, y0 - p.cy, x1 - x0, y1 - y0)
  ctx.lineWidth = S * 0.04
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.stroke(long ? long.rim : path)
  ctx.restore()

  ctx.lineWidth = 1 / sc
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.stroke(long ? long.rim : path)
}

// The back of a piece: plain cardboard in the same outline.
export function drawBack(ctx, { geo, sc }, p, path) {
  const { S } = geo
  const c = ctx.canvas
  ctx.setTransform(sc, 0, 0, sc, c.width / 2, c.height / 2)
  const long = longPaths(p, S * GROW)
  shadow(ctx, S, sc, path, long, '#cdbd9f')
  // The cut shadow pass can take a sliver of the cardboard with it; fill it in again.
  if (long) {
    ctx.fillStyle = '#cdbd9f'
    ctx.fill(long.fill)
  }
  ctx.save()
  ctx.clip(long ? long.fill : path)
  ctx.lineWidth = S * 0.04
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'
  ctx.stroke(long ? long.rim : path)
  ctx.restore()
  ctx.lineWidth = 1 / sc
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.stroke(long ? long.rim : path)
}

// The sprite followed by its halved copies. make(w, h) returns a blank canvas of that size. Each
// copy covers the same area as the sprite, so all of them are drawn at the sprite's world size.
export function levels(src, make) {
  const out = [src]
  let prev = src
  for (let k = 0; k < MIPS; k++) {
    const c = make(Math.max(1, Math.ceil(prev.width / 2)), Math.max(1, Math.ceil(prev.height / 2)))
    const ctx = c.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(prev, 0, 0, c.width, c.height)
    out.push(c)
    prev = c
  }
  return out
}
