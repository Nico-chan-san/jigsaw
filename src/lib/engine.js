// Imperative canvas engine: rendering, camera, dragging, rotation and snapping.
import { buildPuzzle, outlinePath } from './geometry.js'

const Q = Math.PI / 2
const COS = [1, 0, -1, 0]
const SIN = [0, 1, 0, -1]
const mod4 = (k) => ((k % 4) + 4) % 4
const rot = (x, y, k) => {
  k = mod4(k)
  return [x * COS[k] - y * SIN[k], x * SIN[k] + y * COS[k]]
}
const ease = (dt, ms) => 1 - Math.exp(-dt / ms)

export class Engine {
  constructor(canvas, { room, image, pieces, user, guard, tooltip, send, onGroups, onComplete, onReady }) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.layer = document.createElement('canvas')
    this.lctx = this.layer.getContext('2d')
    this.hlLayer = document.createElement('canvas')
    this.hlCtx = this.hlLayer.getContext('2d')
    this.hitCtx = document.createElement('canvas').getContext('2d')
    this.room = room
    this.image = image
    this.user = user
    // Called before any action that needs a player name; returns false to block it.
    this.guard = guard
    this.tooltip = tooltip
    this.send = send
    this.onGroups = onGroups
    this.onComplete = onComplete
    this.onReady = onReady

    this.geo = buildPuzzle(room)
    const n = (this.n = room.cols * room.rows)
    this.paths = this.geo.pieces.map((p) => outlinePath(p.outline))
    this.x = new Float64Array(n)
    this.y = new Float64Array(n)
    this.r = new Int8Array(n)
    this.g = new Int32Array(n)
    this.by = new Array(n).fill(null)
    this.hl = null
    for (const p of pieces) {
      this.x[p.i] = p.x
      this.y[p.i] = p.y
      this.r[p.i] = p.r
      this.g[p.i] = p.g
      this.by[p.i] = p.by || null
    }
    const sizes = new Map()
    for (let i = 0; i < n; i++) sizes.set(this.g[i], (sizes.get(this.g[i]) || 0) + 1)
    this.order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => sizes.get(this.g[b]) - sizes.get(this.g[a]),
    )

    const { w, h, S, pad } = this.geo
    this.margin = pad + S * 0.12
    this.radius = Math.hypot(w / 2 + this.margin, h / 2 + this.margin)
    const spriteArea = n * (w + 2 * this.margin) * (h + 2 * this.margin)
    this.spriteScale = Math.min(2, Math.max(0.35, Math.sqrt(16e6 / spriteArea)))
    this.imgScale = image.naturalWidth / room.width
    this.sprites = new Array(n)
    this.built = 0

    const b = this.bbox(this.order)
    const ext = Math.max(b.x1 - b.x0, b.y1 - b.y0, room.width, room.height) * 2.5
    const mx = (b.x0 + b.x1) / 2
    const my = (b.y0 + b.y1) / 2
    this.bounds = { x0: mx - ext, y0: my - ext, x1: mx + ext, y1: my + ext }

    this.dpr = window.devicePixelRatio || 1
    this.vw = 1
    this.vh = 1
    this.cam = { x: mx, y: my, z: 1 }
    this.camAnim = null
    this.drag = null
    this.lift = null
    this.pan = null
    this.pointers = new Map()
    this.held = new Map()
    this.moving = new Map()
    this.colors = { bg: '#f4f4f4', dot: 'rgba(0,0,0,.12)', shadow: 'rgba(0,0,0,.35)' }
    this.last = performance.now()
    this.lastLive = 0
    this.hoverAt = null

    this.bind()
    this.resize()
    const saved = this.loadCam()
    if (saved) this.cam = saved
    else this.fit(false)
  }

  // ---- lifecycle ----------------------------------------------------------

  bind() {
    const c = this.canvas
    this.h = {
      down: (e) => this.onDown(e),
      move: (e) => this.onMove(e),
      up: (e) => this.onUp(e),
      wheel: (e) => this.onWheel(e),
      key: (e) => this.onKey(e),
      leave: () => {
        this.showTip(null)
        this.setHighlight(null)
      },
      menu: (e) => e.preventDefault(),
    }
    c.addEventListener('pointerdown', this.h.down)
    c.addEventListener('pointermove', this.h.move)
    c.addEventListener('pointerup', this.h.up)
    c.addEventListener('pointercancel', this.h.up)
    c.addEventListener('pointerleave', this.h.leave)
    c.addEventListener('wheel', this.h.wheel, { passive: false })
    c.addEventListener('contextmenu', this.h.menu)
    window.addEventListener('keydown', this.h.key)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(c)
  }

  destroy() {
    const c = this.canvas
    c.removeEventListener('pointerdown', this.h.down)
    c.removeEventListener('pointermove', this.h.move)
    c.removeEventListener('pointerup', this.h.up)
    c.removeEventListener('pointercancel', this.h.up)
    c.removeEventListener('pointerleave', this.h.leave)
    c.removeEventListener('wheel', this.h.wheel)
    c.removeEventListener('contextmenu', this.h.menu)
    window.removeEventListener('keydown', this.h.key)
    this.ro.disconnect()
    cancelAnimationFrame(this.raf)
    this.raf = -1
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    this.dpr = window.devicePixelRatio || 1
    this.vw = Math.max(1, rect.width)
    this.vh = Math.max(1, rect.height)
    for (const c of [this.canvas, this.layer, this.hlLayer]) {
      c.width = Math.round(this.vw * this.dpr)
      c.height = Math.round(this.vh * this.dpr)
    }
    this.invalidate()
  }

  setColors(colors) {
    this.colors = colors
    this.invalidate()
  }

  invalidate() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.render())
  }

  // ---- camera -------------------------------------------------------------

  get zmin() {
    return Math.min(4 / this.geo.S, (this.vw / (this.bounds.x1 - this.bounds.x0)) * 2)
  }
  get zmax() {
    return 900 / this.geo.S
  }

  toWorld(sx, sy) {
    return [(sx - this.vw / 2) / this.cam.z + this.cam.x, (sy - this.vh / 2) / this.cam.z + this.cam.y]
  }

  clampCam() {
    const { x0, y0, x1, y1 } = this.bounds
    this.cam.z = Math.min(this.zmax, Math.max(this.zmin, this.cam.z))
    this.cam.x = Math.min(x1, Math.max(x0, this.cam.x))
    this.cam.y = Math.min(y1, Math.max(y0, this.cam.y))
    this.saveCam()
  }

  zoomAt(sx, sy, f) {
    const [wx, wy] = this.toWorld(sx, sy)
    this.cam.z = Math.min(this.zmax, Math.max(this.zmin, this.cam.z * f))
    this.cam.x = wx - (sx - this.vw / 2) / this.cam.z
    this.cam.y = wy - (sy - this.vh / 2) / this.cam.z
    this.clampCam()
    this.invalidate()
  }

  zoomBy(f) {
    this.camAnim = null
    this.zoomAt(this.vw / 2, this.vh / 2, f)
  }

  bbox(ids) {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    const e = Math.max(this.geo.w, this.geo.h) / 2 + this.geo.pad
    for (const i of ids) {
      x0 = Math.min(x0, this.x[i] - e)
      y0 = Math.min(y0, this.y[i] - e)
      x1 = Math.max(x1, this.x[i] + e)
      y1 = Math.max(y1, this.y[i] + e)
    }
    return { x0, y0, x1, y1 }
  }

  frame(b, fill = 0.85, animate = true) {
    const z = Math.min(
      this.zmax,
      Math.max(this.zmin, Math.min((this.vw * fill) / (b.x1 - b.x0), (this.vh * fill) / (b.y1 - b.y0))),
    )
    const to = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z }
    if (animate) this.camAnim = { from: { ...this.cam }, to, t0: performance.now(), ms: 550 }
    else this.cam = to
    this.invalidate()
  }

  fit(animate = true) {
    this.frame(this.bbox(this.order), 0.9, animate)
  }

  focusGroup(gid) {
    this.frame(this.bbox(this.members(gid)), 0.6)
  }

  saveCam() {
    clearTimeout(this.camTimer)
    this.camTimer = setTimeout(() => {
      try {
        localStorage.setItem(`cam:${this.room.id}`, JSON.stringify(this.cam))
      } catch {}
    }, 300)
  }

  loadCam() {
    try {
      const c = JSON.parse(localStorage.getItem(`cam:${this.room.id}`))
      if (c && isFinite(c.x) && isFinite(c.y) && c.z > 0) return c
    } catch {}
    return null
  }

  // ---- pieces -------------------------------------------------------------

  isComplete() {
    const g = this.g[0]
    for (let i = 1; i < this.n; i++) if (this.g[i] !== g) return false
    return true
  }

  // Per player: how many pieces they connected.
  contributors() {
    const m = new Map()
    const get = (name) => {
      if (!m.has(name)) m.set(name, { name, pieces: 0 })
      return m.get(name)
    }
    for (let i = 0; i < this.n; i++) if (this.by[i]) get(this.by[i]).pieces++
    return m
  }

  members(gid) {
    const out = []
    for (let i = 0; i < this.n; i++) if (this.g[i] === gid) out.push(i)
    return out
  }

  groups() {
    const map = new Map()
    for (let i = 0; i < this.n; i++) {
      const g = this.g[i]
      if (!map.has(g)) map.set(g, [])
      map.get(g).push(i)
    }
    return [...map.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([g, ids]) => ({ g, size: ids.length, key: `${g}:${ids.length}:${this.r[g]}` }))
      .sort((a, b) => b.size - a.size)
  }

  emitGroups() {
    clearTimeout(this.groupTimer)
    this.groupTimer = setTimeout(() => this.onGroups?.(this.groups()), 120)
  }

  toTop(set) {
    this.order = this.order.filter((i) => !set.has(i)).concat([...set])
  }

  makeSprite(i) {
    const { w, h, S } = this.geo
    const m = this.margin
    const sc = this.spriteScale
    const p = this.geo.pieces[i]
    const path = this.paths[i]
    const c = document.createElement('canvas')
    c.width = Math.ceil((w + 2 * m) * sc)
    c.height = Math.ceil((h + 2 * m) * sc)
    const ctx = c.getContext('2d')
    ctx.setTransform(sc, 0, 0, sc, c.width / 2, c.height / 2)

    ctx.shadowColor = 'rgba(0,0,0,0.32)'
    ctx.shadowBlur = S * 0.05 * sc
    ctx.fillStyle = '#777'
    ctx.fill(path)
    ctx.shadowColor = 'transparent'

    ctx.save()
    ctx.clip(path)
    const k = this.imgScale
    const W = this.room.width
    const H = this.room.height
    const x0 = Math.max(0, p.cx - w / 2 - m)
    const y0 = Math.max(0, p.cy - h / 2 - m)
    const x1 = Math.min(W, p.cx + w / 2 + m)
    const y1 = Math.min(H, p.cy + h / 2 + m)
    ctx.drawImage(this.image, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, x0 - p.cx, y0 - p.cy, x1 - x0, y1 - y0)
    ctx.lineWidth = S * 0.04
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.stroke(path)
    ctx.restore()

    ctx.lineWidth = 1 / sc
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.stroke(path)
    return c
  }

  hit(wx, wy) {
    const R = this.radius
    for (let k = this.order.length - 1; k >= 0; k--) {
      const i = this.order[k]
      const dx = wx - this.x[i]
      const dy = wy - this.y[i]
      if (dx > R || dx < -R || dy > R || dy < -R) continue
      const [lx, ly] = rot(dx, dy, -this.r[i])
      if (this.hitCtx.isPointInPath(this.paths[i], lx, ly)) return i
    }
    return -1
  }

  // ---- input --------------------------------------------------------------

  pos(e) {
    const r = this.canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  onDown(e) {
    const [sx, sy] = this.pos(e)
    this.canvas.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, [sx, sy])
    this.camAnim = null

    if (this.drag) {
      if (e.pointerType === 'touch' && e.pointerId !== this.drag.pointer) this.rotate(1)
      return
    }
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.pan = null
      this.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }
      return
    }
    if (e.button === 0) {
      const [wx, wy] = this.toWorld(sx, sy)
      const i = this.hit(wx, wy)
      if (i >= 0 && !(this.held.get(i) > performance.now())) {
        if (this.guard && !this.guard()) return
        return this.startDrag(i, wx, wy, e.pointerId, sx, sy)
      }
    }
    this.pan = { pointer: e.pointerId, sx, sy }
    this.canvas.style.cursor = 'grabbing'
  }

  onMove(e) {
    const [sx, sy] = this.pos(e)
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [sx, sy])

    if (this.drag && e.pointerId === this.drag.pointer) {
      this.drag.sx = sx
      this.drag.sy = sy
      this.updatePivot()
      this.sendLive()
      this.invalidate()
      return
    }
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      const d = Math.hypot(a[0] - b[0], a[1] - b[1])
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      this.cam.x -= (m[0] - this.pinch.m[0]) / this.cam.z
      this.cam.y -= (m[1] - this.pinch.m[1]) / this.cam.z
      this.zoomAt(m[0], m[1], d / this.pinch.d)
      this.pinch = { d, m }
      return
    }
    if (this.pan && e.pointerId === this.pan.pointer) {
      this.cam.x -= (sx - this.pan.sx) / this.cam.z
      this.cam.y -= (sy - this.pan.sy) / this.cam.z
      this.pan.sx = sx
      this.pan.sy = sy
      this.clampCam()
      this.invalidate()
      return
    }
    if (e.pointerType === 'mouse' && !e.buttons) this.hover(sx, sy)
  }

  onUp(e) {
    this.pointers.delete(e.pointerId)
    if (this.drag && e.pointerId === this.drag.pointer) this.drop()
    if (this.pan && e.pointerId === this.pan.pointer) {
      this.pan = null
      this.canvas.style.cursor = ''
    }
    if (this.pointers.size < 2) this.pinch = null
  }

  onWheel(e) {
    e.preventDefault()
    this.camAnim = null
    const [sx, sy] = this.pos(e)
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
    const dy = Math.max(-200, Math.min(200, e.deltaY * unit))
    this.zoomAt(sx, sy, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)))
    if (this.drag) this.updatePivot()
  }

  onKey(e) {
    if (!this.drag) return
    const dir = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key]
    if (!dir) return
    e.preventDefault()
    if (!e.repeat) this.rotate(dir)
  }

  // Groups only form through grid neighbours, so a piece is connected iff a neighbour shares its group.
  connected(i) {
    const { cols, rows } = this.room
    const c = i % cols
    const g = this.g[i]
    return (
      (c > 0 && this.g[i - 1] === g) ||
      (c < cols - 1 && this.g[i + 1] === g) ||
      (i >= cols && this.g[i - cols] === g) ||
      (i < (rows - 1) * cols && this.g[i + cols] === g)
    )
  }

  // Hovering a connected piece shows who connected it.
  hover(sx, sy) {
    const [wx, wy] = this.toWorld(sx, sy)
    const i = this.hit(wx, wy)
    this.canvas.style.cursor = i >= 0 ? 'grab' : ''
    let hl = null
    if (i >= 0 && this.by[i] && this.connected(i)) hl = { key: `p:${i}`, ids: [i], text: this.by[i] }
    this.setHighlight(hl)
    this.showTip(hl ? { text: hl.text, sx, sy } : null)
  }

  setHighlight(hl) {
    if (hl?.key === this.hl?.key) return
    this.hl = hl
    this.invalidate()
  }

  showTip(t) {
    const el = this.tooltip
    if (!el) return
    if (!t) {
      el.style.opacity = '0'
      return
    }
    if (el.textContent !== t.text) el.textContent = t.text
    el.style.transform = `translate(${Math.round(t.sx + 14)}px, ${Math.round(t.sy + 16)}px)`
    el.style.opacity = '1'
  }

  // ---- dragging -----------------------------------------------------------

  startDrag(i, wx, wy, pointer, sx, sy) {
    const ids = this.members(this.g[i])
    const set = new Set(ids)
    this.toTop(set)
    this.drag = {
      ids,
      set,
      pointer,
      sx,
      sy,
      px: wx,
      py: wy,
      ox: ids.map((j) => this.x[j] - wx),
      oy: ids.map((j) => this.y[j] - wy),
      r0: ids.map((j) => this.r[j]),
      k: 0,
      angle: 0,
    }
    const keep = this.lift && this.lift.ids.length === ids.length && set.has(this.lift.ids[0])
    this.lift = { ids, set, value: keep ? this.lift.value : 0, target: 1, px: wx, py: wy }
    this.canvas.style.cursor = 'grabbing'
    this.showTip(null)
    this.setHighlight(null)
    this.sendLive()
    this.invalidate()
  }

  updatePivot() {
    const d = this.drag
    const [wx, wy] = this.toWorld(d.sx, d.sy)
    const { x0, y0, x1, y1 } = this.bounds
    d.px = Math.min(x1, Math.max(x0, wx))
    d.py = Math.min(y1, Math.max(y0, wy))
    this.lift.px = d.px
    this.lift.py = d.py
  }

  rotate(dir) {
    if (!this.drag) return
    this.drag.k += dir
    this.sendLive(true)
    this.invalidate()
  }

  dragState() {
    const d = this.drag
    return d.ids.map((i, j) => {
      const [ox, oy] = rot(d.ox[j], d.oy[j], d.k)
      return { i, x: d.px + ox, y: d.py + oy, r: mod4(d.r0[j] + d.k), g: this.g[i] }
    })
  }

  sendLive(force) {
    const now = performance.now()
    clearTimeout(this.liveTimer)
    if (force || now - this.lastLive > 60) {
      this.lastLive = now
      if (this.drag) this.send(this.dragState(), true)
    } else {
      this.liveTimer = setTimeout(() => this.sendLive(true), 60)
    }
  }

  drop() {
    clearTimeout(this.liveTimer)
    const d = this.drag
    for (const p of this.dragState()) {
      this.x[p.i] = p.x
      this.y[p.i] = p.y
      this.r[p.i] = p.r
    }
    this.drag = null
    const changed = this.snap(d.ids)
    this.lift.target = 0
    this.canvas.style.cursor = ''
    this.send(
      [...changed].map((i) => ({ i, x: this.x[i], y: this.y[i], r: this.r[i], g: this.g[i], by: this.by[i] })),
      false,
    )
    this.emitGroups()
    this.invalidate()
    if (this.isComplete()) {
      this.onComplete?.()
      setTimeout(() => this.fit(), 250)
    }
  }

  snap(ids) {
    const { cols, rows } = this.room
    const { w, h, S } = this.geo
    const thr = S * 0.22
    const group = new Set(ids)
    const changed = new Set(ids)
    const nbrs = (i) => {
      const c = i % cols
      const r = (i / cols) | 0
      const out = []
      if (c > 0) out.push(i - 1)
      if (c < cols - 1) out.push(i + 1)
      if (r > 0) out.push(i - cols)
      if (r < rows - 1) out.push(i + cols)
      return out
    }
    const gap = (p, q) => {
      if (this.r[p] !== this.r[q]) return null
      const dc = (q % cols) - (p % cols)
      const dr = ((q / cols) | 0) - ((p / cols) | 0)
      const [ex, ey] = rot(dc * w, dr * h, this.r[p])
      const dx = this.x[q] - (this.x[p] + ex)
      const dy = this.y[q] - (this.y[p] + ey)
      return { dx, dy, d: Math.hypot(dx, dy) }
    }
    // A single piece that gets connected is credited to this player (kept forever);
    // pieces already in a module keep their names.
    const credit = (list) => {
      if (list.length !== 1) return
      const i = list[0]
      if (!this.by[i]) {
        this.by[i] = this.user
        changed.add(i)
      }
    }
    const shift = (list, dx, dy) => {
      for (const i of list) {
        this.x[i] += dx
        this.y[i] += dy
        changed.add(i)
      }
    }

    // Snap the dropped group onto the closest matching neighbour.
    let best = null
    for (const p of ids) {
      for (const q of nbrs(p)) {
        if (group.has(q)) continue
        const m = gap(p, q)
        if (m && m.d < thr && (!best || m.d < best.d)) best = { p, q, ...m }
      }
    }
    if (!best) return changed
    shift(ids, best.dx, best.dy)
    credit(ids)
    const target = this.members(this.g[best.q])
    if (target.length === 1) credit(target)
    for (const i of target) {
      group.add(i)
      changed.add(i)
    }

    // Pull in any other groups that now line up with the merged one.
    for (let found = true; found; ) {
      found = false
      for (const p of [...group]) {
        for (const q of nbrs(p)) {
          if (group.has(q)) continue
          const m = gap(p, q)
          if (!m || m.d >= thr) continue
          const other = this.members(this.g[q])
          shift(other, -m.dx, -m.dy)
          for (const i of other) group.add(i)
          credit(other)
          found = true
        }
      }
    }

    let gid = Infinity
    for (const i of group) gid = Math.min(gid, i)
    for (const i of group) {
      if (this.g[i] !== gid) {
        this.g[i] = gid
        changed.add(i)
      }
    }
    return changed
  }

  // ---- remote -------------------------------------------------------------

  applyRemote(list, live) {
    const now = performance.now()
    const touched = new Set()
    for (const p of list) {
      if (this.drag?.set.has(p.i)) continue
      if (live) this.held.set(p.i, now + 2500)
      else this.held.delete(p.i)
      this.moving.set(p.i, [p.x, p.y])
      this.r[p.i] = p.r
      this.g[p.i] = p.g
      if (p.by !== undefined && p.by !== null) this.by[p.i] = p.by
      touched.add(p.i)
    }
    if (touched.size) this.toTop(touched)
    if (!live) {
      this.emitGroups()
      if (this.isComplete()) this.onComplete?.()
    }
    this.invalidate()
  }

  // ---- rendering ----------------------------------------------------------

  render() {
    if (this.raf === -1) return
    this.raf = 0
    const now = performance.now()
    const dt = Math.min(64, now - this.last)
    this.last = now
    let again = false

    if (this.built < this.n) {
      while (this.built < this.n && performance.now() - now < 12) {
        this.sprites[this.built] = this.makeSprite(this.built)
        this.built++
      }
      if (this.built === this.n) this.onReady?.()
      again = true
    }

    if (this.camAnim) {
      const a = this.camAnim
      const t = Math.min(1, (now - a.t0) / a.ms)
      const e = 1 - Math.pow(1 - t, 3)
      const lz = Math.log(a.from.z) + (Math.log(a.to.z) - Math.log(a.from.z)) * e
      this.cam = {
        x: a.from.x + (a.to.x - a.from.x) * e,
        y: a.from.y + (a.to.y - a.from.y) * e,
        z: Math.exp(lz),
      }
      if (t >= 1) {
        this.camAnim = null
        this.clampCam()
      } else again = true
    }

    if (this.drag) {
      const d = this.drag
      const edge = 40
      const vx = d.sx < edge ? -(edge - d.sx) : d.sx > this.vw - edge ? d.sx - (this.vw - edge) : 0
      const vy = d.sy < edge ? -(edge - d.sy) : d.sy > this.vh - edge ? d.sy - (this.vh - edge) : 0
      if (vx || vy) {
        this.cam.x += (vx * 0.4 * dt) / 16 / this.cam.z
        this.cam.y += (vy * 0.4 * dt) / 16 / this.cam.z
        this.clampCam()
        this.updatePivot()
        this.sendLive()
        again = true
      }
      const target = d.k * Q
      d.angle += (target - d.angle) * ease(dt, 45)
      if (Math.abs(target - d.angle) > 0.001) again = true
      else d.angle = target
    }

    if (this.lift) {
      const l = this.lift
      l.value += (l.target - l.value) * ease(dt, l.target ? 55 : 70)
      if (Math.abs(l.target - l.value) < 0.005) {
        l.value = l.target
        if (!l.target) this.lift = null
      } else again = true
    }

    for (const [i, [tx, ty]] of this.moving) {
      const f = ease(dt, 40)
      this.x[i] += (tx - this.x[i]) * f
      this.y[i] += (ty - this.y[i]) * f
      if (Math.abs(tx - this.x[i]) + Math.abs(ty - this.y[i]) < 0.05) {
        this.x[i] = tx
        this.y[i] = ty
        this.moving.delete(i)
      } else again = true
    }

    this.draw()
    if (again) this.invalidate()
  }

  draw() {
    const { ctx, dpr, vw, vh, cam } = this
    this.onView?.(cam, vw, vh)
    const { S } = this.geo
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = this.colors.bg
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    // Dot grid.
    let sp = S
    while (sp * cam.z < 22) sp *= 2
    while (sp * cam.z > 44) sp /= 2
    const [wx0, wy0] = this.toWorld(0, 0)
    const [wx1, wy1] = this.toWorld(vw, vh)
    const ds = Math.max(1, 1.25 * dpr)
    ctx.fillStyle = this.colors.dot
    ctx.beginPath()
    for (let gx = Math.floor(wx0 / sp) * sp; gx <= wx1; gx += sp) {
      const px = ((gx - cam.x) * cam.z + vw / 2) * dpr
      for (let gy = Math.floor(wy0 / sp) * sp; gy <= wy1; gy += sp) {
        ctx.rect(px - ds / 2, ((gy - cam.y) * cam.z + vh / 2) * dpr - ds / 2, ds, ds)
      }
    }
    ctx.fill()

    const R = this.radius
    const lifted = this.lift?.set
    const sc = this.spriteScale
    for (const i of this.order) {
      if (lifted?.has(i)) continue
      const x = this.x[i]
      const y = this.y[i]
      if (x + R < wx0 || x - R > wx1 || y + R < wy0 || y - R > wy1) continue
      this.drawPiece(ctx, i, x, y, this.r[i] * Q, 1, sc)
    }

    if (this.hl && !this.drag) this.drawOutline(this.hl.ids)

    if (this.lift) {
      const l = this.lift
      const lc = this.lctx
      lc.setTransform(1, 0, 0, 1, 0, 0)
      lc.clearRect(0, 0, this.layer.width, this.layer.height)
      const s = 1 + 0.045 * l.value
      const d = this.drag && this.drag.set === l.set ? this.drag : null
      l.ids.forEach((i, j) => {
        let x, y, a
        if (d) {
          const c = Math.cos(d.angle)
          const sn = Math.sin(d.angle)
          x = d.px + (d.ox[j] * c - d.oy[j] * sn) * s
          y = d.py + (d.ox[j] * sn + d.oy[j] * c) * s
          a = d.r0[j] * Q + d.angle
        } else {
          x = l.px + (this.x[i] - l.px) * s
          y = l.py + (this.y[i] - l.py) * s
          a = this.r[i] * Q
        }
        if (x + R * s < wx0 || x - R * s > wx1 || y + R * s < wy0 || y - R * s > wy1) return
        this.drawPiece(lc, i, x, y, a, s, sc)
      })
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.shadowColor = this.colors.shadow
      ctx.shadowBlur = (4 + 26 * l.value) * dpr
      ctx.shadowOffsetX = (1 + 7 * l.value) * dpr
      ctx.shadowOffsetY = (2 + 16 * l.value) * dpr
      ctx.drawImage(this.layer, 0, 0)
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
    }
  }

  // Outline around the union of the given pieces (no inner seams): stroke every
  // outline, then punch the piece shapes back out.
  drawOutline(ids) {
    const { cam, dpr, vw, vh } = this
    const c = this.hlCtx
    const z = cam.z * dpr
    const place = (i) => {
      const a = this.r[i] * Q
      const co = Math.cos(a) * z
      const sn = Math.sin(a) * z
      c.setTransform(co, sn, -sn, co, ((this.x[i] - cam.x) * cam.z + vw / 2) * dpr, ((this.y[i] - cam.y) * cam.z + vh / 2) * dpr)
    }
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, this.hlLayer.width, this.hlLayer.height)
    c.lineJoin = 'round'
    c.strokeStyle = this.colors.line || '#000'
    c.lineWidth = (5 * dpr) / z
    for (const i of ids) {
      place(i)
      c.stroke(this.paths[i])
    }
    c.globalCompositeOperation = 'destination-out'
    c.lineWidth = (1.5 * dpr) / z
    for (const i of ids) {
      place(i)
      c.fill(this.paths[i])
      c.stroke(this.paths[i])
    }
    c.globalCompositeOperation = 'source-over'
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.drawImage(this.hlLayer, 0, 0)
  }

  drawPiece(ctx, i, x, y, a, s, sc) {
    const sp = this.sprites[i]
    if (!sp) return
    const { cam, dpr, vw, vh } = this
    const z = cam.z * dpr * s
    const c = Math.cos(a) * z
    const sn = Math.sin(a) * z
    ctx.setTransform(c, sn, -sn, c, ((x - cam.x) * cam.z + vw / 2) * dpr, ((y - cam.y) * cam.z + vh / 2) * dpr)
    const w = sp.width / sc
    const h = sp.height / sc
    ctx.drawImage(sp, -w / 2, -h / 2, w, h)
  }

  // Renders a group, as it currently lies on the table, into a small canvas.
  thumb(gid, canvas, size) {
    const ids = this.members(gid)
    if (!ids.length) return
    const b = this.bbox(ids)
    const bw = b.x1 - b.x0
    const bh = b.y1 - b.y0
    const k = size / Math.max(bw, bh)
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(bw * k * dpr))
    canvas.height = Math.max(1, Math.round(bh * k * dpr))
    canvas.style.width = `${Math.round(bw * k)}px`
    canvas.style.height = `${Math.round(bh * k)}px`
    const ctx = canvas.getContext('2d')
    const z = k * dpr
    for (const i of ids) {
      const sp = this.sprites[i]
      if (!sp) continue
      const a = this.r[i] * Q
      const c = Math.cos(a) * z
      const sn = Math.sin(a) * z
      ctx.setTransform(c, sn, -sn, c, (this.x[i] - b.x0) * z, (this.y[i] - b.y0) * z)
      const w = sp.width / this.spriteScale
      const h = sp.height / this.spriteScale
      ctx.drawImage(sp, -w / 2, -h / 2, w, h)
    }
  }
}
