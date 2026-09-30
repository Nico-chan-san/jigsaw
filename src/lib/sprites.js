// Piece sprites, drawn the same way on the main thread and in sprites.worker.js: the picture cut to
// a piece's outline with a soft shadow, the plain cardboard back, and halved copies of either for
// drawing zoomed out.

// How many halved copies each sprite gets, so a sprite list is [full, 1/2, 1/4, 1/8].
export const MIPS = 3

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

  ctx.shadowColor = 'rgba(0,0,0,0.32)'
  ctx.shadowBlur = S * 0.05 * sc
  ctx.fillStyle = '#777'
  ctx.fill(path)
  ctx.shadowColor = 'transparent'

  ctx.save()
  ctx.clip(path)
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
  ctx.stroke(path)
  ctx.restore()

  ctx.lineWidth = 1 / sc
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.stroke(path)
}

// The back of a piece: plain cardboard in the same outline.
export function drawBack(ctx, { geo, sc }, path) {
  const { S } = geo
  const c = ctx.canvas
  ctx.setTransform(sc, 0, 0, sc, c.width / 2, c.height / 2)
  ctx.shadowColor = 'rgba(0,0,0,0.32)'
  ctx.shadowBlur = S * 0.05 * sc
  ctx.fillStyle = '#cdbd9f'
  ctx.fill(path)
  ctx.shadowColor = 'transparent'
  ctx.save()
  ctx.clip(path)
  ctx.lineWidth = S * 0.04
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'
  ctx.stroke(path)
  ctx.restore()
  ctx.lineWidth = 1 / sc
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.stroke(path)
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
