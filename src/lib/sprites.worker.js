// Builds every piece's sprites off the main thread and posts them back in batches as ImageBitmaps:
// first the fronts, then the backs of the face down pieces. Posts { kind: 'fail' } if it can't draw
// here, and the engine builds whatever is missing itself.
import { buildPuzzle, outlinePath } from './geometry.js'
import { drawBack, drawFront, levels, spriteSize } from './sprites.js'

// A batch is posted after about this long (ms), so sprites show up while the rest are drawn.
const BATCH_MS = 16

self.onmessage = (e) => {
  const { room, image, margin, sc, backs } = e.data
  try {
    const geo = buildPuzzle(room)
    const o = { geo, room, image, margin, sc }
    const [W, H] = spriteSize(geo, margin, sc)
    const make = (w, h) => new OffscreenCanvas(w, h)
    const blank = () => {
      const ctx = make(W, H).getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      return ctx
    }
    let items = []
    let transfer = []
    let t = performance.now()
    const add = (i, ctx) => {
      const lv = levels(ctx.canvas, make).map((c) => c.transferToImageBitmap())
      items.push({ i, lv })
      transfer.push(...lv)
    }
    const flush = (kind, force) => {
      if (!items.length || (!force && performance.now() - t < BATCH_MS)) return
      self.postMessage({ kind, items }, transfer)
      items = []
      transfer = []
      t = performance.now()
    }
    const paths = geo.pieces.map((p) => outlinePath(p.outline))
    for (const p of geo.pieces) {
      const ctx = blank()
      drawFront(ctx, o, p, paths[p.i])
      add(p.i, ctx)
      flush('front')
    }
    flush('front', true)
    for (const i of backs) {
      const ctx = blank()
      drawBack(ctx, o, geo.pieces[i], paths[i])
      add(i, ctx)
      flush('back')
    }
    flush('back', true)
    self.postMessage({ kind: 'done' })
  } catch (err) {
    self.postMessage({ kind: 'fail', message: String(err) })
  }
}
