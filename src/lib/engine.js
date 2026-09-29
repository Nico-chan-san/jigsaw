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
const r2 = (v) => Math.round(v * 100) / 100
// Live drag updates are throttled to this interval (ms).
const LIVE_MS = 33
// Length of the flip animation (ms), and how far a press may move and still count as a click.
const FLIP_MS = 420
const CLICK_PX = 5
const CLICK_MS = 400
// Largest side of the cached sprite for a lifted selection.
const LIFT_MAX = 3000
// Screen-space size of reference image handles.
const HANDLE = 7
const DEL_R = 11
// Cursor updates are throttled to this interval (ms); idle cursors vanish after CURSOR_IDLE.
const CURSOR_MS = 50
const CURSOR_IDLE = 20000
// Arrow keys and WASD move the camera, at this many screen pixels per second.
const PAN_SPEED = 900
const PAN_KEYS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  w: [0, -1],
  s: [0, 1],
}
const CURSOR_COLORS = ['#e5484d', '#0090ff', '#30a46c', '#f76b15', '#8e4ec6', '#d6409f', '#12a594', '#ca8a04']
const cursorColor = (id) => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length]
}

export class Engine {
  constructor(canvas, { room, image, pieces, refs, overlay, user, userName, nameOf, guard, tooltip, send, onGroups, onComplete, onReady, onRef, onRefDelete, onRefs }) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.layer = document.createElement('canvas')
    this.lctx = this.layer.getContext('2d')
    this.hlLayer = document.createElement('canvas')
    this.hlCtx = this.hlLayer.getContext('2d')
    this.hitCtx = document.createElement('canvas').getContext('2d')
    // Other players' cursors go on a separate canvas stacked above the notes.
    this.overlay = overlay
    this.octx = overlay?.getContext('2d')
    // Everything except the lifted pieces, reused while only the lifted pieces move.
    this.scene = document.createElement('canvas')
    this.sctx = this.scene.getContext('2d')
    this.sceneKey = ''
    this.sceneVer = 0
    // Low resolution buffer for the lifted pieces' drop shadow.
    this.shadowLayer = document.createElement('canvas')
    this.shCtx = this.shadowLayer.getContext('2d')
    this.room = room
    this.image = image
    // This player's id (stored on what they do) and name (shown on their cursor).
    this.user = user
    this.userName = userName
    // Looks up a player's name by id, for the tooltips.
    this.nameOf = nameOf || ((id) => id)
    // Called before any action that needs a player name; returns false to block it.
    this.guard = guard
    this.tooltip = tooltip
    this.send = send
    this.onGroups = onGroups
    this.onComplete = onComplete
    this.onReady = onReady
    // Reference image changes: onRef(ref, live) while and after editing, onRefDelete(id).
    this.onRef = onRef
    this.onRefDelete = onRefDelete
    // Called with the image list whenever an image is added or removed.
    this.onRefs = onRefs

    this.geo = buildPuzzle(room)
    const n = (this.n = room.cols * room.rows)
    this.paths = this.geo.pieces.map((p) => outlinePath(p.outline))
    this.x = new Float64Array(n)
    this.y = new Float64Array(n)
    this.r = new Int8Array(n)
    this.g = new Int32Array(n)
    this.by = new Array(n).fill(null)
    // Face down pieces (hardcore mode), their back sprites, and flips in progress: i -> start time.
    this.f = new Uint8Array(n)
    this.backs = new Array(n)
    this.flips = new Map()
    // Pieces turned in place on the table, still animating: i -> { cx, cy, a } (a in radians, decays to 0).
    this.turns = new Map()
    this.hl = null
    // Selected pieces (always whole groups), reference images and notes, by id.
    this.sel = new Set()
    this.selRefs = new Set()
    this.selNotes = new Set()
    // Set by the notes layer: { get() -> [{ id, x, y, w, h }], move(list, send), select(ids), focus(id) }.
    this.notes = null
    // Images and notes riding along with a drag: { pointer, wx, wy, sx0, sy0, moved, note, refs, notes }.
    this.carry = null
    this.marquee = null
    // Other players' drags in progress: client -> { ids, ox, oy, r0 }.
    this.remote = new Map()
    // Other players' pointers: client -> { x, y, tx, ty, name, color, t }.
    this.cursors = new Map()
    this.lastCursor = 0
    for (const p of pieces) {
      this.x[p.i] = p.x
      this.y[p.i] = p.y
      this.r[p.i] = p.r
      this.g[p.i] = p.g
      this.by[p.i] = p.by || null
      this.f[p.i] = p.f ? 1 : 0
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

    // Reference images, shared by the room: { id, x, y, w, author } in world units (centre and width).
    this.refs = (refs || []).filter((r) => isFinite(r.x) && isFinite(r.y) && r.w > 0)
    this.refSel = null
    this.refDrag = null
    this.refAspect = image.naturalHeight / image.naturalWidth
    const rk = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight))
    this.refImg = document.createElement('canvas')
    this.refImg.width = Math.max(1, Math.round(image.naturalWidth * rk))
    this.refImg.height = Math.max(1, Math.round(image.naturalHeight * rk))
    this.refImg.getContext('2d').drawImage(image, 0, 0, this.refImg.width, this.refImg.height)

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
    // Pan keys held down right now.
    this.panKeys = new Set()
    // View mode: the left button (and a finger) moves the table instead of pieces or selecting.
    this.panMode = false
    this.held = new Map()
    this.moving = new Map()
    this.colors = { bg: '#f4f4f4', dot: 'rgba(0,0,0,.12)', shadow: 'rgba(0,0,0,.35)', sel: '#2f6fed' }
    this.last = performance.now()
    this.lastLive = 0
    this.viewKey = ''

    // Whether the jigsaw is finished, so finishing it is only noticed once.
    this.done = this.isComplete()

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
      keyup: (e) => {
        if (this.panKeys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key)) this.invalidate(false)
      },
      stopPan: () => this.panKeys.clear(),
      leave: () => {
        this.showTip(null)
        this.setHighlight(null)
      },
      // The pointer is tracked over the whole window, so notes and panels above the canvas don't hide it.
      track: (e) => {
        if (!e.isPrimary) return
        const [sx, sy] = this.pos(e)
        if (sx < 0 || sy < 0 || sx > this.vw || sy > this.vh) return
        this.pointerAt = [sx, sy]
        this.sendCursor()
      },
      gone: () => {
        if (this.drag) return
        clearTimeout(this.cursorTimer)
        this.pointerAt = null
        this.send({ type: 'cursor', hide: true })
      },
      menu: (e) => e.preventDefault(),
      // The browser's own drag and drop (of a page selection, say) never starts from the table.
      nodrag: (e) => e.preventDefault(),
    }
    c.addEventListener('pointerdown', this.h.down)
    c.addEventListener('pointermove', this.h.move)
    c.addEventListener('pointerup', this.h.up)
    c.addEventListener('pointercancel', this.h.up)
    c.addEventListener('pointerleave', this.h.leave)
    c.addEventListener('wheel', this.h.wheel, { passive: false })
    c.addEventListener('contextmenu', this.h.menu)
    this.host = c.parentElement
    this.host?.addEventListener('dragstart', this.h.nodrag)
    window.addEventListener('keydown', this.h.key)
    window.addEventListener('keyup', this.h.keyup)
    window.addEventListener('blur', this.h.stopPan)
    window.addEventListener('pointermove', this.h.track, true)
    document.documentElement.addEventListener('pointerleave', this.h.gone)
    window.addEventListener('blur', this.h.gone)
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
    this.host?.removeEventListener('dragstart', this.h.nodrag)
    window.removeEventListener('keydown', this.h.key)
    window.removeEventListener('keyup', this.h.keyup)
    window.removeEventListener('blur', this.h.stopPan)
    window.removeEventListener('pointermove', this.h.track, true)
    document.documentElement.removeEventListener('pointerleave', this.h.gone)
    window.removeEventListener('blur', this.h.gone)
    this.ro.disconnect()
    cancelAnimationFrame(this.raf)
    this.raf = -1
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    this.dpr = window.devicePixelRatio || 1
    this.vw = Math.max(1, rect.width)
    this.vh = Math.max(1, rect.height)
    for (const c of [this.canvas, this.layer, this.hlLayer, this.scene, this.overlay]) {
      if (!c) continue
      c.width = Math.round(this.vw * this.dpr)
      c.height = Math.round(this.vh * this.dpr)
    }
    this.invalidate()
  }

  setColors(colors) {
    this.colors = colors
    this.invalidate()
  }

  // scene = false means only the lifted pieces changed, so the cached scene stays valid.
  invalidate(scene = true) {
    if (scene) this.sceneVer++
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

  // Eases the zoom around the middle of the view. Presses during the animation add up.
  zoomBy(f) {
    const a = this.camAnim
    const from = a?.zoom ? a.to : this.cam
    const z = Math.min(this.zmax, Math.max(this.zmin, from.z * f))
    this.camAnim = { from: { ...this.cam }, to: { x: from.x, y: from.y, z }, t0: performance.now(), ms: 260, zoom: true }
    this.invalidate()
  }

  bbox(ids, e = Math.max(this.geo.w, this.geo.h) / 2 + this.geo.pad) {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
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

  focusRef(id) {
    const ref = this.refs.find((r) => r.id === id)
    if (!ref) return
    const [w, h] = this.refSize(ref)
    this.frame({ x0: ref.x - w / 2, y0: ref.y - h / 2, x1: ref.x + w / 2, y1: ref.y + h / 2 }, 0.6)
  }

  focusNote(id) {
    const n = this.notes?.get().find((n) => n.id === id)
    if (n) this.frame({ x0: n.x, y0: n.y, x1: n.x + n.w, y1: n.y + n.h }, 0.4)
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

  // Per player id: how many pieces they connected.
  contributors() {
    const m = new Map()
    const get = (id) => {
      if (!m.has(id)) m.set(id, { id, pieces: 0 })
      return m.get(id)
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
    this.sceneVer++
  }

  // Expands a set of pieces to the whole groups they belong to.
  withGroups(ids) {
    const gids = new Set()
    for (const i of ids) gids.add(this.g[i])
    const out = new Set()
    for (let i = 0; i < this.n; i++) if (gids.has(this.g[i])) out.add(i)
    return out
  }

  // Splits a list of pieces into one list per group.
  modules(ids) {
    const m = new Map()
    for (const i of ids) {
      if (!m.has(this.g[i])) m.set(this.g[i], [])
      m.get(this.g[i]).push(i)
    }
    return [...m.values()]
  }

  // The selected pieces that nobody else is holding right now.
  freeSelection() {
    const now = performance.now()
    return [...this.withGroups(this.sel)].filter((i) => !(this.held.get(i) > now))
  }

  // Ends any movement animation on these pieces, so they sit where they are headed.
  settle(ids) {
    for (const i of ids) {
      const to = this.moving.get(i)
      if (to) [this.x[i], this.y[i]] = to
      this.moving.delete(i)
    }
  }

  // Where piece i is drawn on the table: [x, y, angle], including a turn in progress.
  pose(i) {
    const t = this.turns.get(i)
    if (!t) return [this.x[i], this.y[i], this.r[i] * Q]
    const dx = this.x[i] - t.cx
    const dy = this.y[i] - t.cy
    const c = Math.cos(t.a)
    const s = Math.sin(t.a)
    return [t.cx + dx * c - dy * s, t.cy + dx * s + dy * c, this.r[i] * Q + t.a]
  }

  setSelection(set, refs = new Set(), notes = new Set()) {
    this.sel = set
    this.selRefs = refs
    const same = notes.size === this.selNotes.size && [...notes].every((id) => this.selNotes.has(id))
    this.selNotes = notes
    if (!same) this.notes?.select(notes)
    this.invalidate()
  }

  get selCount() {
    return this.sel.size + this.selRefs.size + this.selNotes.size
  }

  selectAll() {
    const pieces = new Set(Array.from({ length: this.n }, (_, i) => i))
    const refs = new Set(this.refs.map((r) => r.id))
    const notes = new Set((this.notes?.get() || []).map((n) => n.id))
    this.selectRef(null)
    this.setSelection(pieces, refs, notes)
  }

  toggleRef(id) {
    const refs = new Set(this.selRefs)
    refs.has(id) ? refs.delete(id) : refs.add(id)
    this.setSelection(this.sel, refs, this.selNotes)
  }

  toggleNote(id) {
    const notes = new Set(this.selNotes)
    notes.has(id) ? notes.delete(id) : notes.add(id)
    this.setSelection(this.sel, this.selRefs, notes)
  }

  // Picks up the whole selection: its pieces as a normal drag, with images and notes riding along.
  // Also called by the notes layer when a selected note is dragged, hence the pointer capture.
  grabSelection(e, from = {}) {
    const [sx, sy] = this.pos(e)
    const [wx, wy] = this.toWorld(sx, sy)
    if (!this.pointers.has(e.pointerId)) {
      this.canvas.setPointerCapture(e.pointerId)
      this.pointers.set(e.pointerId, [sx, sy])
    }
    const now = performance.now()
    const ids = [...this.withGroups(this.sel)].filter((j) => !(this.held.get(j) > now))
    if (ids.length) {
      this.startDrag(ids, wx, wy, e.pointerId, sx, sy)
      // Only a press on a piece can be a click that flips it.
      if (!from.piece) this.drag.moved = true
    }
    const notes = this.notes?.get().filter((n) => this.selNotes.has(n.id)) || []
    this.carry = {
      pointer: e.pointerId,
      wx: this.drag ? this.drag.px : wx,
      wy: this.drag ? this.drag.py : wy,
      sx0: sx,
      sy0: sy,
      moved: false,
      note: from.note || null,
      refs: this.refs.filter((r) => this.selRefs.has(r.id)).map((r) => ({ id: r.id, x: r.x, y: r.y })),
      notes: notes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
    }
    // Carried images go on top, like a lifted piece.
    this.refs = this.refs.filter((r) => !this.selRefs.has(r.id)).concat(this.refs.filter((r) => this.selRefs.has(r.id)))
    this.invalidate()
  }

  carryAt(wx, wy) {
    const c = this.carry
    const dx = wx - c.wx
    const dy = wy - c.wy
    return {
      refs: c.refs.map((r) => ({ id: r.id, x: r.x + dx, y: r.y + dy })),
      notes: c.notes.map((n) => ({ id: n.id, x: n.x + dx, y: n.y + dy })),
    }
  }

  moveCarry(wx, wy) {
    const c = this.carry
    if (!c) return
    c.at = [wx, wy]
    const { refs, notes } = this.carryAt(wx, wy)
    for (const p of refs) {
      const ref = this.refs.find((r) => r.id === p.id)
      if (ref) Object.assign(ref, p)
    }
    if (notes.length) this.notes?.move(notes, null)
    this.sendCarry()
    this.invalidate(!!refs.length)
  }

  sendCarry(force) {
    const now = performance.now()
    clearTimeout(this.carryTimer)
    const c = this.carry
    if (!c?.at) return
    if (force || now - (this.lastCarry || 0) >= LIVE_MS) {
      this.lastCarry = now
      const { refs, notes } = this.carryAt(...c.at)
      for (const p of refs) {
        const ref = this.refs.find((r) => r.id === p.id)
        if (ref) this.onRef?.(ref, true)
      }
      if (notes.length) this.notes?.move(notes, 'live')
    } else {
      this.carryTimer = setTimeout(() => this.sendCarry(true), LIVE_MS - (now - this.lastCarry))
    }
  }

  endCarry() {
    const c = this.carry
    this.carry = null
    clearTimeout(this.carryTimer)
    if (!c) return
    // A click on a selected note without moving edits it instead.
    if (!c.moved && c.note) {
      this.setSelection(new Set())
      return this.notes?.focus(c.note)
    }
    if (!c.at) return
    const { refs, notes } = this.carryAt(...c.at)
    for (const p of refs) {
      const ref = this.refs.find((r) => r.id === p.id)
      if (ref) this.onRef?.(ref, false)
    }
    if (notes.length) this.notes?.move(notes, 'save')
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

  // The back of a piece: plain cardboard in the same outline. It is drawn mirrored, see face().
  makeBack(i) {
    const { w, h, S } = this.geo
    const m = this.margin
    const sc = this.spriteScale
    const path = this.paths[i]
    const c = document.createElement('canvas')
    c.width = Math.ceil((w + 2 * m) * sc)
    c.height = Math.ceil((h + 2 * m) * sc)
    const ctx = c.getContext('2d')
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
    return c
  }

  // What to draw for piece i: its sprite, the horizontal scale in the piece's own frame and an
  // extra lift. Face down pieces are mirrored (sx = -1), as a real piece turned over is. A flip in
  // progress squeezes the piece through its edge and swaps sprites halfway.
  face(i, still = false) {
    let sx = this.f[i] ? -1 : 1
    let lift = 1
    const t0 = still ? undefined : this.flips.get(i)
    if (t0 !== undefined) {
      const p = Math.min(1, (performance.now() - t0) / FLIP_MS)
      const e = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p)
      sx = -sx * Math.cos(Math.PI * e)
      lift = 1 + 0.18 * Math.sin(Math.PI * e)
    }
    const sp = sx >= 0 ? this.sprites[i] : (this.backs[i] ??= this.makeBack(i))
    return { sp, sx, lift }
  }

  hit(wx, wy) {
    const R = this.radius
    for (let k = this.order.length - 1; k >= 0; k--) {
      const i = this.order[k]
      const dx = wx - this.x[i]
      const dy = wy - this.y[i]
      if (dx > R || dx < -R || dy > R || dy < -R) continue
      const [rx, ly] = rot(dx, dy, -this.r[i])
      const lx = this.f[i] ? -rx : rx
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
    // A page selection (from Cmd+A in the browser, say) has no business on the table.
    if (!window.getSelection()?.isCollapsed) window.getSelection().removeAllRanges()
    const [sx, sy] = this.pos(e)
    this.canvas.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, [sx, sy])
    this.camAnim = null

    if (this.drag) {
      if (e.pointerType === 'touch' && e.pointerId !== this.drag.pointer) this.spin(1)
      return
    }
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.pan = null
      this.marquee = null
      this.refDrag = null
      this.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }
      this.invalidate()
      return
    }
    // Right (or middle) button drags the table, as does any press in view mode.
    if (e.button === 1 || e.button === 2 || (this.panMode && e.button === 0)) return this.startPan(e.pointerId, sx, sy)
    if (e.button !== 0) return

    const [wx, wy] = this.toWorld(sx, sy)
    const rh = this.refHit(sx, sy)
    const i = rh && rh.mode !== 'move' ? -1 : this.hit(wx, wy)
    if (i >= 0) {
      if (this.held.get(i) > performance.now()) return
      if (this.guard && !this.guard()) return
      this.selectRef(null)
      if (e.shiftKey) {
        // Shift-click toggles a group in or out of the selection.
        const grp = this.members(this.g[i])
        const next = new Set(this.sel)
        const on = !next.has(i)
        for (const j of grp) on ? next.add(j) : next.delete(j)
        return this.setSelection(next, this.selRefs, this.selNotes)
      }
      if (this.sel.has(i)) this.grabSelection(e, { piece: true })
      else {
        if (this.selCount) this.setSelection(new Set())
        this.startDrag(this.members(this.g[i]), wx, wy, e.pointerId, sx, sy)
      }
      // Remembered so a click (no drag) can select what was clicked.
      if (this.drag) this.drag.piece = i
      return
    }
    if (rh?.mode === 'move' && e.shiftKey) {
      if (this.guard && !this.guard()) return
      return this.toggleRef(rh.ref.id)
    }
    if (rh?.mode === 'move' && this.selRefs.has(rh.ref.id) && this.selCount > 1) {
      if (this.guard && !this.guard()) return
      this.selectRef(null)
      return this.grabSelection(e)
    }
    if (rh) return this.startRefDrag(rh, e.pointerId, wx, wy)
    if (e.pointerType === 'touch') return this.startPan(e.pointerId, sx, sy)

    // Left drag on the empty table draws a selection box; shift adds to the selection.
    this.selectRef(null)
    const keep = e.shiftKey
    this.marquee = {
      pointer: e.pointerId,
      sx0: sx,
      sy0: sy,
      sx,
      sy,
      base: keep ? new Set(this.sel) : new Set(),
      baseRefs: keep ? new Set(this.selRefs) : new Set(),
      baseNotes: keep ? new Set(this.selNotes) : new Set(),
    }
    if (!keep && this.selCount) this.setSelection(new Set())
  }

  startPan(pointer, sx, sy) {
    this.pan = { pointer, sx, sy }
    this.canvas.style.cursor = 'grabbing'
    this.showTip(null)
    this.setHighlight(null)
  }

  onMove(e) {
    const [sx, sy] = this.pos(e)
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [sx, sy])
    // Pressing the right button while holding pieces turns them, like space. A second button on a
    // pointer that is already down arrives as a move with e.button set, not as a pointerdown.
    if (this.drag && e.pointerId === this.drag.pointer && e.button === 2 && e.buttons & 2) this.spin(1, e.shiftKey)

    const c = this.carry
    if (c && e.pointerId === c.pointer) {
      if (Math.hypot(sx - c.sx0, sy - c.sy0) > CLICK_PX) c.moved = true
      if (!this.drag) {
        this.moveCarry(...this.toWorld(sx, sy))
        return
      }
    }
    if (this.drag && e.pointerId === this.drag.pointer) {
      const d = this.drag
      d.sx = sx
      d.sy = sy
      if (Math.hypot(sx - d.sx0, sy - d.sy0) > CLICK_PX) d.moved = true
      this.updatePivot()
      this.sendLive()
      this.invalidate(false)
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
    if (this.marquee && e.pointerId === this.marquee.pointer) {
      this.marquee.sx = sx
      this.marquee.sy = sy
      this.updateMarquee()
      return
    }
    if (this.refDrag && e.pointerId === this.refDrag.pointer) {
      this.moveRef(...this.toWorld(sx, sy))
      return
    }
    if (e.pointerType === 'mouse' && !e.buttons) this.hover(sx, sy)
  }

  onUp(e) {
    this.pointers.delete(e.pointerId)
    if (this.drag && e.pointerId === this.drag.pointer) {
      const d = this.drag
      const click = this.room.annoying && d.ids.length === 1 && !d.moved && performance.now() - d.t0 < CLICK_MS
      this.drop()
      if (click) this.flip(d.ids[0])
      // Clicking a piece without dragging selects it (its whole module), and only it.
      if (!d.moved && d.piece !== undefined) this.setSelection(new Set(this.members(this.g[d.piece])))
    }
    if (this.carry && e.pointerId === this.carry.pointer) this.endCarry()
    if (this.pan && e.pointerId === this.pan.pointer) {
      this.pan = null
      this.canvas.style.cursor = this.panMode ? 'grab' : ''
    }
    if (this.marquee && e.pointerId === this.marquee.pointer) {
      this.marquee = null
      this.invalidate()
    }
    if (this.refDrag && e.pointerId === this.refDrag.pointer) {
      const { ref } = this.refDrag
      this.refDrag = null
      clearTimeout(this.refTimer)
      this.onRef?.(ref, false)
    }
    if (this.pointers.size < 2) this.pinch = null
  }

  // Selects every group with a piece centre inside the box.
  updateMarquee() {
    const m = this.marquee
    const [ax, ay] = this.toWorld(Math.min(m.sx0, m.sx), Math.min(m.sy0, m.sy))
    const [bx, by] = this.toWorld(Math.max(m.sx0, m.sx), Math.max(m.sy0, m.sy))
    const hit = []
    for (let i = 0; i < this.n; i++) {
      const x = this.x[i]
      const y = this.y[i]
      if (x >= ax && x <= bx && y >= ay && y <= by) hit.push(i)
    }
    const next = this.withGroups(hit)
    for (const i of m.base) next.add(i)
    // Images and notes count when their centre is inside the box, like pieces.
    const inside = (x, y) => x >= ax && x <= bx && y >= ay && y <= by
    const refs = new Set(m.baseRefs)
    for (const r of this.refs) if (inside(r.x, r.y)) refs.add(r.id)
    const notes = new Set(m.baseNotes)
    for (const n of this.notes?.get() || []) if (inside(n.x + n.w / 2, n.y + n.h / 2)) notes.add(n.id)
    this.setSelection(next, refs, notes)
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
    if (e.target?.closest?.('input, textarea, [contenteditable]')) return
    // Dialogs over the board keep the keyboard.
    if (document.querySelector('.modal-bg')) return
    if (e.key === 'Escape' && !this.drag) {
      if (this.selCount) this.setSelection(new Set())
      this.selectRef(null)
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !this.refDrag && !this.drag) {
      if (!this.refSel && !this.selRefs.size && !this.selNotes.size) return
      e.preventDefault()
      return this.removeSelected()
    }
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    // Cmd/Ctrl+A selects everything on the table, rather than the page's text.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && key === 'a' && !this.drag) {
      e.preventDefault()
      return this.selectAll()
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    // Arrow keys and WASD move around the table while held, also while carrying pieces.
    if (PAN_KEYS[key]) {
      e.preventDefault()
      this.camAnim = null
      this.panKeys.add(key)
      this.invalidate(false)
      return
    }
    // While holding pieces: space turns them, G gathers the carried groups.
    if (this.drag) {
      if (key !== ' ' && key !== 'g') return
      e.preventDefault()
      if (e.repeat) return
      return key === ' ' ? this.spin(1, e.shiftKey) : this.gather()
    }
    // With a selection on the table, space turns the pieces where they lie (shift: all as one) and G
    // sorts them into a grid.
    if ((key === ' ' || key === 'g') && this.sel.size) {
      e.preventDefault()
      if (!e.repeat) key === 'g' ? this.sortSelection() : this.rotateSelection(1, e.shiftKey)
    }
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
    if (this.panMode) {
      this.canvas.style.cursor = 'grab'
      this.setHighlight(null)
      return this.showTip(null)
    }
    const [wx, wy] = this.toWorld(sx, sy)
    const rh = this.refHit(sx, sy)
    const i = rh && rh.mode !== 'move' ? -1 : this.hit(wx, wy)
    this.canvas.style.cursor =
      i >= 0
        ? 'grab'
        : rh?.mode === 'del'
          ? 'pointer'
          : rh?.mode === 'resize'
            ? rh.cx === rh.cy
              ? 'nwse-resize'
              : 'nesw-resize'
            : rh
              ? 'move'
              : ''
    let hl = null
    if (i >= 0 && this.by[i] && this.connected(i)) hl = { key: `p:${i}`, ids: [i], text: this.nameOf(this.by[i]) }
    this.setHighlight(hl)
    // Hovering a reference image (not covered by a piece) shows who put it there.
    const text = hl ? hl.text : i < 0 && rh?.ref.author ? this.nameOf(rh.ref.author) : null
    this.showTip(text ? { text, sx, sy } : null)
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

  startDrag(ids, wx, wy, pointer, sx, sy) {
    if (!ids.length) return
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
      // Per piece: the centre of its module and the part of a spin still animating (radians).
      cx: new Float64Array(ids.length),
      cy: new Float64Array(ids.length),
      sa: new Float64Array(ids.length),
      // Per piece: the part of a gather (G) still animating, as an offset in world units.
      tx: new Float64Array(ids.length),
      ty: new Float64Array(ids.length),
      spinning: false,
      // A press that neither moves nor turns anything is a click (flips a piece in hardcore mode).
      t0: performance.now(),
      sx0: sx,
      sy0: sy,
      moved: false,
    }
    for (const i of ids) {
      this.flips.delete(i)
      this.turns.delete(i)
      this.moving.delete(i)
    }
    const keep = this.lift && this.lift.ids.length === ids.length && set.has(this.lift.ids[0])
    this.lift = { ids, set, value: keep ? this.lift.value : 0, target: 1, px: wx, py: wy, angle: 0 }
    this.buildLiftSprite()
    this.canvas.style.cursor = 'grabbing'
    this.showTip(null)
    this.setHighlight(null)
    const d = this.drag
    this.send({ type: 'grab', ids, ox: d.ox.map(r2), oy: d.oy.map(r2), r0: d.r0, px: r2(wx), py: r2(wy) })
    this.lastLive = performance.now()
    this.invalidate()
  }

  // Renders the lifted pieces once into a single canvas, so each frame of a drag
  // is one drawImage no matter how many pieces are being carried.
  buildLiftSprite() {
    const d = this.drag
    const R = this.radius
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let j = 0; j < d.ids.length; j++) {
      x0 = Math.min(x0, d.ox[j] - R)
      y0 = Math.min(y0, d.oy[j] - R)
      x1 = Math.max(x1, d.ox[j] + R)
      y1 = Math.max(y1, d.oy[j] + R)
    }
    const res = Math.min(this.cam.z * this.dpr * 1.05, this.spriteScale, LIFT_MAX / Math.max(x1 - x0, y1 - y0))
    const c = this.lift.sprite?.c || document.createElement('canvas')
    c.width = Math.max(1, Math.ceil((x1 - x0) * res))
    c.height = Math.max(1, Math.ceil((y1 - y0) * res))
    const ctx = c.getContext('2d')
    const sc = this.spriteScale
    for (let j = 0; j < d.ids.length; j++) {
      const { sp, sx } = this.face(d.ids[j], true)
      if (!sp) continue
      const a = d.r0[j] * Q
      const co = Math.cos(a) * res
      const sn = Math.sin(a) * res
      ctx.setTransform(co * sx, sn * sx, -sn, co, (d.ox[j] - x0) * res, (d.oy[j] - y0) * res)
      const w = sp.width / sc
      const h = sp.height / sc
      ctx.drawImage(sp, -w / 2, -h / 2, w, h)
    }
    this.lift.sprite = { c, x0, y0, x1, y1, res, target: res }
  }

  updatePivot() {
    const d = this.drag
    const [wx, wy] = this.toWorld(d.sx, d.sy)
    const { x0, y0, x1, y1 } = this.bounds
    d.px = Math.min(x1, Math.max(x0, wx))
    d.py = Math.min(y1, Math.max(y0, wy))
    this.lift.px = d.px
    this.lift.py = d.py
    this.moveCarry(d.px, d.py)
  }

  // Turns each carried module a quarter around its own centre, leaving the modules where they are.
  // With whole, everything carried turns together around its common centre instead.
  spin(dir, whole = false) {
    const d = this.drag
    if (!d) return
    const at = new Map(d.ids.map((i, j) => [i, j]))
    const sets = whole ? [d.ids.map((_, j) => j)] : this.modules(d.ids).map((m) => m.map((i) => at.get(i)))
    for (const js of sets) {
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const j of js) {
        x0 = Math.min(x0, d.ox[j])
        y0 = Math.min(y0, d.oy[j])
        x1 = Math.max(x1, d.ox[j])
        y1 = Math.max(y1, d.oy[j])
      }
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      for (const j of js) {
        const [rx, ry] = rot(d.ox[j] - cx, d.oy[j] - cy, dir)
        d.ox[j] = cx + rx
        d.oy[j] = cy + ry
        ;[d.tx[j], d.ty[j]] = rot(d.tx[j], d.ty[j], dir)
        d.r0[j] = mod4(d.r0[j] + dir)
        d.cx[j] = cx
        d.cy[j] = cy
        d.sa[j] -= dir * Q
      }
    }
    d.spinning = true
    d.moved = true
    this.buildLiftSprite()
    // Other players get the new offsets as a fresh grab that keeps the current turn.
    this.send({ type: 'grab', ids: d.ids, ox: d.ox.map(r2), oy: d.oy.map(r2), r0: d.r0, px: r2(d.px), py: r2(d.py), k: d.k })
    this.invalidate(false)
  }

  // Room around a module when laying modules out side by side: enough that tabs don't overlap
  // and neighbours stay out of snapping range of each other.
  get packExtent() {
    return Math.max(this.geo.w, this.geo.h) / 2 + this.geo.pad * 0.7
  }

  // Lays boxes ({ x0, y0, x1, y1 }) out in a square grid centred on 0, in reading order of where
  // they lie now. Every column is as wide as its widest box and every row as tall as its tallest.
  // Returns the new centre of each box.
  pack(boxes) {
    const S = this.geo.S
    const gap = S * 0.12
    const mid = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]
    const order = boxes
      .map((b, k) => ({ k, x: mid(b)[0], row: Math.round(mid(b)[1] / (S * 1.5)) }))
      .sort((a, b) => a.row - b.row || a.x - b.x)
      .map((o) => o.k)
    const cols = Math.ceil(Math.sqrt(boxes.length))
    const rows = Math.ceil(boxes.length / cols)
    const cw = new Array(cols).fill(0)
    const rh = new Array(rows).fill(0)
    order.forEach((k, n) => {
      const b = boxes[k]
      cw[n % cols] = Math.max(cw[n % cols], b.x1 - b.x0)
      rh[(n / cols) | 0] = Math.max(rh[(n / cols) | 0], b.y1 - b.y0)
    })
    const starts = (sizes) => {
      let at = -(sizes.reduce((a, b) => a + b, 0) + gap * (sizes.length - 1)) / 2
      return sizes.map((v) => {
        const s = at
        at += v + gap
        return s
      })
    }
    const xs = starts(cw)
    const ys = starts(rh)
    const out = new Array(boxes.length)
    order.forEach((k, n) => {
      const c = n % cols
      const r = (n / cols) | 0
      out[k] = [xs[c] + cw[c] / 2, ys[r] + rh[r] / 2]
    })
    return out
  }

  // G while holding several groups: pulls them together in a grid around the pointer, none overlapping.
  gather() {
    const d = this.drag
    if (!d) return
    const at = new Map(d.ids.map((i, j) => [i, j]))
    const mods = this.modules(d.ids).map((m) => m.map((i) => at.get(i)))
    if (mods.length < 2) return
    const e = this.packExtent
    const boxes = mods.map((js) => {
      const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
      for (const j of js) {
        b.x0 = Math.min(b.x0, d.ox[j] - e)
        b.y0 = Math.min(b.y0, d.oy[j] - e)
        b.x1 = Math.max(b.x1, d.ox[j] + e)
        b.y1 = Math.max(b.y1, d.oy[j] + e)
      }
      return b
    })
    const spots = this.pack(boxes)
    mods.forEach((js, m) => {
      const b = boxes[m]
      const dx = spots[m][0] - (b.x0 + b.x1) / 2
      const dy = spots[m][1] - (b.y0 + b.y1) / 2
      for (const j of js) {
        d.ox[j] += dx
        d.oy[j] += dy
        d.cx[j] += dx
        d.cy[j] += dy
        d.tx[j] -= dx
        d.ty[j] -= dy
      }
    })
    d.spinning = true
    d.moved = true
    this.buildLiftSprite()
    this.send({ type: 'grab', ids: d.ids, ox: d.ox.map(r2), oy: d.oy.map(r2), r0: d.r0, px: r2(d.px), py: r2(d.py), k: d.k })
    this.invalidate(false)
  }

  // Snaps each module on its own, then eases every piece the snap moved from where it was.
  snapModules(mods) {
    const x0 = this.x.slice()
    const y0 = this.y.slice()
    const changed = new Set()
    for (const m of mods) for (const j of this.snap(m)) changed.add(j)
    for (const i of changed) {
      if (this.x[i] === x0[i] && this.y[i] === y0[i]) continue
      this.moving.set(i, [this.x[i], this.y[i]])
      this.x[i] = x0[i]
      this.y[i] = y0[i]
    }
    return changed
  }

  // Space with a selection: turns each selected module a quarter around its centre, on the table.
  // With whole (shift), the selection turns as one around its common centre.
  rotateSelection(dir, whole = false) {
    if (this.guard && !this.guard()) return
    const ids = this.freeSelection()
    if (!ids.length) return
    this.settle(ids)
    const mods = this.modules(ids)
    for (const m of whole ? [ids] : mods) {
      const b = this.bbox(m, 0)
      const cx = (b.x0 + b.x1) / 2
      const cy = (b.y0 + b.y1) / 2
      for (const i of m) {
        const [rx, ry] = rot(this.x[i] - cx, this.y[i] - cy, dir)
        this.x[i] = cx + rx
        this.y[i] = cy + ry
        this.r[i] = mod4(this.r[i] + dir)
        this.flips.delete(i)
        this.turns.set(i, { cx, cy, a: (this.turns.get(i)?.a || 0) - dir * Q })
      }
    }
    this.commit(this.snapModules(mods))
  }

  // Lays the selected modules out in a square grid, centred where the selection lies now.
  sortSelection() {
    if (this.guard && !this.guard()) return
    const ids = this.freeSelection()
    if (!ids.length) return
    this.settle(ids)
    const mods = this.modules(ids)
    const all = this.bbox(ids, 0)
    const cx = (all.x0 + all.x1) / 2
    const cy = (all.y0 + all.y1) / 2
    const boxes = mods.map((m) => this.bbox(m, this.packExtent))
    const spots = this.pack(boxes)
    const x0 = this.x.slice()
    const y0 = this.y.slice()
    mods.forEach((m, k) => {
      const b = boxes[k]
      const dx = cx + spots[k][0] - (b.x0 + b.x1) / 2
      const dy = cy + spots[k][1] - (b.y0 + b.y1) / 2
      for (const i of m) {
        this.x[i] += dx
        this.y[i] += dy
      }
    })
    const changed = this.snapModules(mods)
    // Ease everything from where it was, not just what the snap moved.
    for (const i of ids) {
      if (!this.moving.has(i)) this.moving.set(i, [this.x[i], this.y[i]])
      this.x[i] = x0[i]
      this.y[i] = y0[i]
    }
    this.toTop(new Set(ids))
    this.commit(changed)
  }

  // Tells everyone where these pieces ended up (after a drop, turn or sort) and updates the rest.
  commit(changed) {
    if (this.sel.size) this.sel = this.withGroups(this.sel)
    this.send({
      type: 'moves',
      pieces: [...changed].map((i) => {
        const [x, y] = this.moving.get(i) || [this.x[i], this.y[i]]
        return { i, x, y, r: this.r[i], g: this.g[i], by: this.by[i], f: this.f[i] }
      }),
    })
    this.emitGroups()
    this.invalidate()
    this.checkComplete()
  }

  // The moment the last piece goes in, by anyone: tell the page and bring the whole jigsaw into view.
  checkComplete() {
    const done = this.isComplete()
    if (done && !this.done) {
      this.onComplete?.()
      setTimeout(() => this.fit(), 250)
    }
    this.done = done
  }

  dragState() {
    const d = this.drag
    return d.ids.map((i, j) => {
      const [ox, oy] = rot(d.ox[j], d.oy[j], d.k)
      return { i, x: d.px + ox, y: d.py + oy, r: mod4(d.r0[j] + d.k), g: this.g[i] }
    })
  }

  sendCursor(force) {
    const now = performance.now()
    clearTimeout(this.cursorTimer)
    if (!this.pointerAt) return
    if (force || now - this.lastCursor >= CURSOR_MS) {
      this.lastCursor = now
      const [x, y] = this.toWorld(...this.pointerAt)
      this.send({ type: 'cursor', x: r2(x), y: r2(y), name: this.userName || '' })
    } else {
      this.cursorTimer = setTimeout(() => this.sendCursor(true), CURSOR_MS - (now - this.lastCursor))
    }
  }

  // While dragging only the pivot and rotation go over the wire; the offsets were sent with "grab".
  sendLive(force) {
    const now = performance.now()
    clearTimeout(this.liveTimer)
    if (!this.drag) return
    if (force || now - this.lastLive >= LIVE_MS) {
      this.lastLive = now
      const d = this.drag
      this.send({ type: 'live', px: r2(d.px), py: r2(d.py), k: d.k })
    } else {
      this.liveTimer = setTimeout(() => this.sendLive(true), LIVE_MS - (now - this.lastLive))
    }
  }

  drop() {
    clearTimeout(this.liveTimer)
    const d = this.drag
    const state = this.dragState()
    for (const p of state) {
      this.x[p.i] = p.x
      this.y[p.i] = p.y
      this.r[p.i] = p.r
    }
    this.drag = null

    // Each carried group snaps on its own, so unrelated groups in a selection never merge by accident.
    const changed = new Set()
    const seen = new Set()
    for (const i of d.ids) {
      if (seen.has(i)) continue
      const grp = this.members(this.g[i]).filter((j) => d.set.has(j))
      for (const j of grp) seen.add(j)
      for (const j of this.snap(grp)) changed.add(j)
    }

    // The lift sprite can keep animating the landing if everything moved by the same snap offset.
    const l = this.lift
    const sdx = this.x[state[0].i] - state[0].x
    const sdy = this.y[state[0].i] - state[0].y
    const rigid = state.every((p) => Math.abs(this.x[p.i] - p.x - sdx) + Math.abs(this.y[p.i] - p.y - sdy) < 1e-6)
    if (rigid && l.sprite) {
      l.px = d.px + sdx
      l.py = d.py + sdy
      l.angle = d.k * Q
    } else l.sprite = null
    l.target = 0

    this.canvas.style.cursor = ''
    this.commit(changed)
  }

  // Turns a loose face down piece face up. It never goes back, so clicking a piece to select it is
  // safe. Pieces in a module are always face up, so they stay put.
  flip(i) {
    if (!this.f[i] || this.connected(i)) return
    this.f[i] ^= 1
    this.flips.set(i, performance.now())
    // The landing sprite still shows the old side; draw the piece itself so the flip is visible.
    if (this.lift?.set.has(i)) this.lift.sprite = null
    this.send({ type: 'moves', pieces: [{ i, x: this.x[i], y: this.y[i], r: this.r[i], g: this.g[i], f: this.f[i] }] })
    this.invalidate()
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
      // Face down pieces never connect.
      if (this.r[p] !== this.r[q] || this.f[p] || this.f[q]) return null
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

  remoteMessage(msg) {
    const now = performance.now()
    if (msg.type === 'grab') {
      const n = msg.ids?.length
      if (!n || msg.ox?.length !== n || msg.oy?.length !== n || msg.r0?.length !== n) return
      const d = { ids: msg.ids, ox: msg.ox, oy: msg.oy, r0: msg.r0 }
      this.remote.set(msg.client, d)
      this.toTop(new Set(d.ids))
      this.remoteLive(d, msg.px, msg.py, msg.k | 0, now)
    } else if (msg.type === 'live') {
      const d = this.remote.get(msg.client)
      if (d) this.remoteLive(d, msg.px, msg.py, msg.k | 0, now)
    } else if (msg.type === 'moves') {
      this.remote.delete(msg.client)
      this.applyRemote(msg.pieces)
    } else if (msg.type === 'cursor') {
      if (msg.hide) this.cursors.delete(msg.client)
      else if (isFinite(msg.x) && isFinite(msg.y)) {
        const c = this.cursors.get(msg.client)
        const name = String(msg.name || '').slice(0, 32) || 'Guest'
        if (c) Object.assign(c, { tx: msg.x, ty: msg.y, name, t: now })
        else {
          const color = cursorColor(msg.client)
          this.cursors.set(msg.client, { x: msg.x, y: msg.y, tx: msg.x, ty: msg.y, name, color, t: now })
        }
      }
      this.invalidate(false)
    } else if (msg.type === 'gone') {
      this.cursors.delete(msg.client)
      const d = this.remote.get(msg.client)
      if (d) for (const i of d.ids) this.held.delete(i)
      this.remote.delete(msg.client)
    }
  }

  remoteLive(d, px, py, k, now) {
    for (let j = 0; j < d.ids.length; j++) {
      const i = d.ids[j]
      if (this.drag?.set.has(i)) continue
      const [ox, oy] = rot(d.ox[j], d.oy[j], k)
      this.held.set(i, now + 2500)
      this.moving.set(i, [px + ox, py + oy])
      this.r[i] = mod4(d.r0[j] + k)
    }
    this.invalidate()
  }

  applyRemote(list) {
    const touched = new Set()
    for (const p of list) {
      if (this.drag?.set.has(p.i)) continue
      this.held.delete(p.i)
      this.moving.set(p.i, [p.x, p.y])
      this.r[p.i] = p.r
      this.g[p.i] = p.g
      if (p.by !== undefined && p.by !== null) this.by[p.i] = p.by
      if (p.f !== undefined && p.f !== null && (p.f ? 1 : 0) !== this.f[p.i]) {
        this.f[p.i] = p.f ? 1 : 0
        this.flips.set(p.i, performance.now())
      }
      touched.add(p.i)
    }
    if (touched.size) this.toTop(touched)
    if (this.sel.size) this.sel = this.withGroups(this.sel)
    this.emitGroups()
    this.checkComplete()
    this.invalidate()
  }

  // After a reconnect: catch up on whatever changed while the socket was down.
  resync(pieces) {
    const list = pieces.filter(
      (p) =>
        p.x !== this.x[p.i] || p.y !== this.y[p.i] || p.r !== this.r[p.i] || p.g !== this.g[p.i] || (p.f ? 1 : 0) !== this.f[p.i],
    )
    if (list.length) this.applyRemote(list)
  }

  // ---- reference images ---------------------------------------------------

  refSize(ref) {
    return [ref.w, ref.w * this.refAspect]
  }

  // Adds the reference image centred on a canvas point, or the middle of the view.
  addRef(sx = this.vw / 2, sy = this.vh / 2) {
    if (this.guard && !this.guard()) return
    const [x, y] = this.toWorld(sx, sy)
    // Fit comfortably in the current view.
    const w = Math.min(this.room.width, ((Math.min(this.vw, this.vh / this.refAspect) * 0.6) / this.cam.z))
    const ref = { id: Math.random().toString(36).slice(2, 10), x, y, w, author: this.user || '' }
    this.refs.push(ref)
    this.selectRef(ref.id)
    this.onRef?.(ref, false)
    this.onRefs?.(this.refs)
  }

  // Delete or Backspace: removes the selected images and notes (pieces stay).
  removeSelected() {
    if (this.guard && !this.guard()) return
    const refs = new Set(this.selRefs)
    if (this.refSel) refs.add(this.refSel)
    const notes = [...this.selNotes]
    for (const id of refs) this.removeRef(id)
    if (notes.length) this.notes?.remove(notes)
    this.setSelection(this.sel)
  }

  removeRef(id, remote = false) {
    if (!remote && this.guard && !this.guard()) return
    this.refs = this.refs.filter((r) => r.id !== id)
    if (this.refSel === id) this.refSel = null
    this.selRefs.delete(id)
    if (this.refDrag?.ref.id === id) this.refDrag = null
    if (!remote) this.onRefDelete?.(id)
    this.onRefs?.(this.refs)
    this.invalidate()
  }

  // Another player added, moved or resized an image.
  remoteRef(ref) {
    if (this.refDrag?.ref.id === ref.id || this.carry?.refs.some((r) => r.id === ref.id)) return
    const cur = this.refs.find((r) => r.id === ref.id)
    if (cur) Object.assign(cur, ref)
    else {
      this.refs.push(ref)
      this.onRefs?.(this.refs)
    }
    this.invalidate()
  }

  setRefs(refs) {
    const dragging = this.refDrag?.ref
    this.refs = refs.map((r) => (dragging && r.id === dragging.id ? dragging : r))
    if (this.refSel && !this.refs.some((r) => r.id === this.refSel)) this.refSel = null
    for (const id of this.selRefs) if (!this.refs.some((r) => r.id === id)) this.selRefs.delete(id)
    this.onRefs?.(this.refs)
    this.invalidate()
  }

  sendRefLive(force) {
    const now = performance.now()
    clearTimeout(this.refTimer)
    const d = this.refDrag
    if (!d) return
    if (force || now - (this.lastRefLive || 0) >= LIVE_MS) {
      this.lastRefLive = now
      this.onRef?.(d.ref, true)
    } else {
      this.refTimer = setTimeout(() => this.sendRefLive(true), LIVE_MS - (now - this.lastRefLive))
    }
  }

  selectRef(id) {
    if (this.refSel === id) return
    this.refSel = id
    this.invalidate()
  }

  // Screen-space corners of a reference image: [x0, y0, x1, y1].
  refRect(ref) {
    const [w, h] = this.refSize(ref)
    const { cam, vw, vh } = this
    return [
      (ref.x - w / 2 - cam.x) * cam.z + vw / 2,
      (ref.y - h / 2 - cam.y) * cam.z + vh / 2,
      (ref.x + w / 2 - cam.x) * cam.z + vw / 2,
      (ref.y + h / 2 - cam.y) * cam.z + vh / 2,
    ]
  }

  // The selected image's handles win over everything; otherwise the topmost image under the point.
  refHit(sx, sy) {
    const sel = this.refs.find((r) => r.id === this.refSel)
    if (sel) {
      const [x0, y0, x1, y1] = this.refRect(sel)
      if (Math.hypot(sx - x1, sy - (y0 - DEL_R - 6)) <= DEL_R + 2) return { ref: sel, mode: 'del' }
      for (const cx of [0, 1]) {
        for (const cy of [0, 1]) {
          const hx = cx ? x1 : x0
          const hy = cy ? y1 : y0
          if (Math.abs(sx - hx) <= HANDLE + 3 && Math.abs(sy - hy) <= HANDLE + 3) return { ref: sel, mode: 'resize', cx, cy }
        }
      }
    }
    for (let k = this.refs.length - 1; k >= 0; k--) {
      const [x0, y0, x1, y1] = this.refRect(this.refs[k])
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) return { ref: this.refs[k], mode: 'move' }
    }
    return null
  }

  startRefDrag(rh, pointer, wx, wy) {
    const ref = rh.ref
    if (rh.mode === 'del') return this.removeRef(ref.id)
    if (this.guard && !this.guard()) return
    this.selectRef(ref.id)
    if (this.selCount) this.setSelection(new Set())
    // Bring to front.
    this.refs = this.refs.filter((r) => r !== ref).concat(ref)
    const [w, h] = this.refSize(ref)
    this.refDrag = {
      ref,
      pointer,
      mode: rh.mode,
      dx: ref.x - wx,
      dy: ref.y - wy,
      // Resizing keeps the opposite corner in place.
      ax: ref.x + (rh.cx ? -w / 2 : w / 2),
      ay: ref.y + (rh.cy ? -h / 2 : h / 2),
      sx: rh.cx ? 1 : -1,
      sy: rh.cy ? 1 : -1,
    }
    this.invalidate()
  }

  moveRef(wx, wy) {
    const d = this.refDrag
    const ref = d.ref
    if (d.mode === 'move') {
      ref.x = wx + d.dx
      ref.y = wy + d.dy
    } else {
      const a = this.refAspect
      const min = this.geo.S
      const w = Math.max(min, Math.max(d.sx * (wx - d.ax), (d.sy * (wy - d.ay)) / a))
      ref.w = w
      ref.x = d.ax + (d.sx * w) / 2
      ref.y = d.ay + (d.sy * w * a) / 2
    }
    this.sendRefLive()
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
      this.sceneVer++
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

    if (this.panKeys.size) {
      let vx = 0
      let vy = 0
      for (const k of this.panKeys) {
        vx += PAN_KEYS[k][0]
        vy += PAN_KEYS[k][1]
      }
      if (vx || vy) {
        const f = (PAN_SPEED * dt) / 1000 / Math.hypot(vx, vy) / this.cam.z
        this.cam.x += vx * f
        this.cam.y += vy * f
        this.clampCam()
        if (this.drag) {
          this.updatePivot()
          this.sendLive()
        }
      }
      again = true
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
      // Re-render the carried sprite if the zoom has drifted far from its resolution.
      const sp = this.lift.sprite
      if (sp) {
        const want = Math.min(this.cam.z * this.dpr * 1.05, this.spriteScale, LIFT_MAX / Math.max(sp.x1 - sp.x0, sp.y1 - sp.y0))
        if (want / sp.res > 1.3 || sp.res / want > 1.3) this.buildLiftSprite()
      }
      const target = d.k * Q
      d.angle += (target - d.angle) * ease(dt, 45)
      if (Math.abs(target - d.angle) > 0.001) again = true
      else d.angle = target
      if (d.spinning) {
        const f = ease(dt, 45)
        const fm = ease(dt, 60)
        let left = 0
        let far = 0
        for (let j = 0; j < d.sa.length; j++) {
          d.sa[j] -= d.sa[j] * f
          d.tx[j] -= d.tx[j] * fm
          d.ty[j] -= d.ty[j] * fm
          left = Math.max(left, Math.abs(d.sa[j]))
          far = Math.max(far, Math.abs(d.tx[j]) + Math.abs(d.ty[j]))
        }
        if (left > 0.001 || far > 0.05) again = true
        else {
          d.sa.fill(0)
          d.tx.fill(0)
          d.ty.fill(0)
          d.spinning = false
        }
      }
    }

    if (this.lift) {
      const l = this.lift
      l.value += (l.target - l.value) * ease(dt, l.target ? 55 : 70)
      if (Math.abs(l.target - l.value) < 0.005) {
        l.value = l.target
        if (!l.target) this.lift = null
      } else again = true
    }

    for (const [id, c] of this.cursors) {
      if (now - c.t > CURSOR_IDLE) {
        this.cursors.delete(id)
        continue
      }
      const f = ease(dt, 45)
      c.x += (c.tx - c.x) * f
      c.y += (c.ty - c.y) * f
      if (Math.abs(c.tx - c.x) + Math.abs(c.ty - c.y) > 0.05) again = true
      else {
        c.x = c.tx
        c.y = c.ty
      }
    }
    if (this.cursors.size) {
      clearTimeout(this.idleTimer)
      this.idleTimer = setTimeout(() => this.invalidate(false), CURSOR_IDLE + 100)
    }

    if (this.turns.size) {
      this.sceneVer++
      const f = ease(dt, 45)
      for (const [i, t] of this.turns) {
        t.a -= t.a * f
        if (Math.abs(t.a) < 0.001) this.turns.delete(i)
      }
      again = true
    }

    if (this.flips.size) {
      this.sceneVer++
      for (const [i, t0] of this.flips) if (now - t0 >= FLIP_MS) this.flips.delete(i)
      again = true
    }

    if (this.moving.size) this.sceneVer++
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
    if (again) this.invalidate(false)
  }

  draw() {
    const { ctx, dpr, vw, vh, cam } = this
    const vk = `${cam.x},${cam.y},${cam.z},${vw},${vh},${dpr}`
    if (vk !== this.viewKey || this.onView !== this.viewFn) {
      this.viewKey = vk
      this.viewFn = this.onView
      this.onView?.(cam, vw, vh)
    }
    const [wx0, wy0] = this.toWorld(0, 0)
    const [wx1, wy1] = this.toWorld(vw, vh)
    const view = { wx0, wy0, wx1, wy1 }

    // While something is lifted, the rest of the table is cached and only redrawn when it changes.
    if (this.lift && this.built === this.n) {
      const key = `${vk}:${this.sceneVer}`
      if (key !== this.sceneKey) {
        this.drawScene(this.sctx, view)
        this.sceneKey = key
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(this.scene, 0, 0)
    } else {
      this.sceneKey = ''
      this.drawScene(ctx, view)
    }
    if (this.lift) this.drawLift(view)
    // Pieces still landing after a drop get their selection outline right away, on top.
    if (this.lift && !this.drag && this.sel.size) {
      const ids = [...this.sel].filter((i) => this.lift.set.has(i))
      if (ids.length) this.drawOutline(ctx, ids, this.colors.sel)
    }
    this.drawChrome()
  }

  drawScene(ctx, { wx0, wy0, wx1, wy1 }) {
    const { dpr, vw, vh, cam } = this
    const { S } = this.geo
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = this.colors.bg
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    // Dot grid.
    let sp = S
    while (sp * cam.z < 22) sp *= 2
    while (sp * cam.z > 44) sp /= 2
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

    // Reference images lie under the pieces.
    const z = cam.z * dpr
    for (const ref of this.refs) {
      const [w, h] = this.refSize(ref)
      if (ref.x + w / 2 < wx0 || ref.x - w / 2 > wx1 || ref.y + h / 2 < wy0 || ref.y - h / 2 > wy1) continue
      ctx.setTransform(z, 0, 0, z, ((ref.x - cam.x) * cam.z + vw / 2) * dpr, ((ref.y - cam.y) * cam.z + vh / 2) * dpr)
      ctx.drawImage(this.refImg, -w / 2, -h / 2, w, h)
      const on = this.selRefs.has(ref.id)
      ctx.lineWidth = ((on ? 3 : 1) * dpr) / z
      ctx.strokeStyle = on ? this.colors.sel : this.colors.dot
      ctx.strokeRect(-w / 2, -h / 2, w, h)
    }

    const R = this.radius
    const lifted = this.lift?.set
    const sc = this.spriteScale
    for (const i of this.order) {
      if (lifted?.has(i)) continue
      const [x, y, a] = this.pose(i)
      if (x + R < wx0 || x - R > wx1 || y + R < wy0 || y - R > wy1) continue
      this.drawPiece(ctx, i, x, y, a, 1, sc)
    }

    if (this.hl && !this.drag) this.drawOutline(ctx, this.hl.ids, this.colors.line || '#000')
    if (this.sel.size) {
      const ids = lifted ? [...this.sel].filter((i) => !lifted.has(i)) : [...this.sel]
      if (ids.length) this.drawOutline(ctx, ids, this.colors.sel)
    }
  }

  // Draws the lifted pieces with a drop shadow. The shadow is blurred at a third of the
  // resolution and only within the lifted pieces' bounding box, which keeps drags cheap.
  drawLift({ wx0, wy0, wx1, wy1 }) {
    const { ctx, dpr, vw, vh, cam } = this
    const l = this.lift
    const lc = this.lctx
    const W = this.layer.width
    const H = this.layer.height
    lc.setTransform(1, 0, 0, 1, 0, 0)
    const pb = this.liftBox
    if (pb) lc.clearRect(pb[0], pb[1], pb[2] - pb[0], pb[3] - pb[1])
    else lc.clearRect(0, 0, W, H)

    const s = 1 + 0.045 * l.value
    const d = this.drag && this.drag.set === l.set ? this.drag : null
    let bx0 = Infinity
    let by0 = Infinity
    let bx1 = -Infinity
    let by1 = -Infinity
    const grow = (x, y) => {
      bx0 = Math.min(bx0, x)
      by0 = Math.min(by0, y)
      bx1 = Math.max(bx1, x)
      by1 = Math.max(by1, y)
    }

    if (d?.spinning) {
      // Mid spin every piece turns on its own, so draw them one by one instead of the sprite.
      const R = this.radius
      const sc = this.spriteScale
      const e = R * s * cam.z * dpr
      const ca = Math.cos(d.angle)
      const sa = Math.sin(d.angle)
      for (let j = 0; j < d.ids.length; j++) {
        const a = d.sa[j]
        const dx = d.ox[j] - d.cx[j]
        const dy = d.oy[j] - d.cy[j]
        const ox = d.cx[j] + dx * Math.cos(a) - dy * Math.sin(a) + d.tx[j]
        const oy = d.cy[j] + dx * Math.sin(a) + dy * Math.cos(a) + d.ty[j]
        const x = l.px + (ox * ca - oy * sa) * s
        const y = l.py + (ox * sa + oy * ca) * s
        if (x + R * s < wx0 || x - R * s > wx1 || y + R * s < wy0 || y - R * s > wy1) continue
        this.drawPiece(lc, d.ids[j], x, y, d.r0[j] * Q + a + d.angle, s, sc)
        const X = ((x - cam.x) * cam.z + vw / 2) * dpr
        const Y = ((y - cam.y) * cam.z + vh / 2) * dpr
        grow(X - e, Y - e)
        grow(X + e, Y + e)
      }
    } else if (l.sprite) {
      const sp = l.sprite
      const a = d ? d.angle : l.angle
      const z = (cam.z * dpr * s) / sp.res
      const co = Math.cos(a) * z
      const sn = Math.sin(a) * z
      const X = ((l.px - cam.x) * cam.z + vw / 2) * dpr
      const Y = ((l.py - cam.y) * cam.z + vh / 2) * dpr
      lc.setTransform(co, sn, -sn, co, X, Y)
      lc.drawImage(sp.c, sp.x0 * sp.res, sp.y0 * sp.res)
      for (const [u, v] of [
        [sp.x0, sp.y0],
        [sp.x1, sp.y0],
        [sp.x0, sp.y1],
        [sp.x1, sp.y1],
      ]) {
        grow(X + (u * co - v * sn) * sp.res, Y + (u * sn + v * co) * sp.res)
      }
    } else {
      const R = this.radius
      const sc = this.spriteScale
      const e = R * s * cam.z * dpr
      for (const i of l.ids) {
        const x = l.px + (this.x[i] - l.px) * s
        const y = l.py + (this.y[i] - l.py) * s
        if (x + R * s < wx0 || x - R * s > wx1 || y + R * s < wy0 || y - R * s > wy1) continue
        this.drawPiece(lc, i, x, y, this.r[i] * Q, s, sc)
        const X = ((x - cam.x) * cam.z + vw / 2) * dpr
        const Y = ((y - cam.y) * cam.z + vh / 2) * dpr
        grow(X - e, Y - e)
        grow(X + e, Y + e)
      }
    }

    const pad = 50 * dpr
    const x0 = Math.max(0, Math.floor(bx0 - pad))
    const y0 = Math.max(0, Math.floor(by0 - pad))
    const x1 = Math.min(W, Math.ceil(bx1 + pad))
    const y1 = Math.min(H, Math.ceil(by1 + pad))
    if (x1 <= x0 || y1 <= y0) {
      this.liftBox = null
      return
    }
    // Pieces are only ever drawn inside the padded box, so next frame only has to clear that.
    this.liftBox = [Math.max(0, Math.floor(bx0 - 2)), Math.max(0, Math.floor(by0 - 2)), Math.min(W, Math.ceil(bx1 + 2)), Math.min(H, Math.ceil(by1 + 2))]
    const bw = x1 - x0
    const bh = y1 - y0

    const k = 3
    const sw = Math.ceil(bw / k)
    const sh = Math.ceil(bh / k)
    const shl = this.shadowLayer
    if (shl.width < sw || shl.height < sh) {
      shl.width = Math.max(shl.width, sw)
      shl.height = Math.max(shl.height, sh)
    }
    const sx = this.shCtx
    sx.setTransform(1, 0, 0, 1, 0, 0)
    sx.clearRect(0, 0, sw + 1, sh + 1)
    // Draw the silhouette off-canvas and let only its shadow land in view.
    const off = shl.width + 20
    sx.shadowColor = this.colors.shadow
    sx.shadowBlur = ((4 + 26 * l.value) * dpr) / k
    sx.shadowOffsetX = off + ((1 + 7 * l.value) * dpr) / k
    sx.shadowOffsetY = ((2 + 16 * l.value) * dpr) / k
    sx.drawImage(this.layer, x0, y0, bw, bh, -off, 0, bw / k, bh / k)
    sx.shadowColor = 'transparent'

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(shl, 0, 0, bw / k, bh / k, x0, y0, bw, bh)
    ctx.drawImage(this.layer, x0, y0, bw, bh, x0, y0, bw, bh)
  }

  // Screen-space overlays: the selection box and the selected reference image's handles.
  drawChrome() {
    const { ctx, dpr } = this
    const sel = this.refSel && this.refs.find((r) => r.id === this.refSel)
    if (sel) {
      const [x0, y0, x1, y1] = this.refRect(sel)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineWidth = 1.5
      ctx.strokeStyle = this.colors.sel
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
      ctx.fillStyle = this.colors.bg
      for (const [hx, hy] of [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ]) {
        ctx.fillRect(hx - HANDLE / 2 - 1, hy - HANDLE / 2 - 1, HANDLE + 2, HANDLE + 2)
        ctx.strokeRect(hx - HANDLE / 2 - 1, hy - HANDLE / 2 - 1, HANDLE + 2, HANDLE + 2)
      }
      const cx = x1
      const cy = y0 - DEL_R - 6
      ctx.beginPath()
      ctx.arc(cx, cy, DEL_R, 0, Math.PI * 2)
      ctx.fillStyle = this.colors.line || '#000'
      ctx.fill()
      const q = DEL_R * 0.38
      ctx.beginPath()
      ctx.moveTo(cx - q, cy - q)
      ctx.lineTo(cx + q, cy + q)
      ctx.moveTo(cx + q, cy - q)
      ctx.lineTo(cx - q, cy + q)
      ctx.lineWidth = 1.6
      ctx.lineCap = 'round'
      ctx.strokeStyle = this.colors.bg
      ctx.stroke()
      ctx.lineCap = 'butt'
    }
    this.drawCursors()
    const m = this.marquee
    if (m && Math.abs(m.sx - m.sx0) + Math.abs(m.sy - m.sy0) > 2) {
      const x = Math.min(m.sx0, m.sx)
      const y = Math.min(m.sy0, m.sy)
      const w = Math.abs(m.sx - m.sx0)
      const h = Math.abs(m.sy - m.sy0)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalAlpha = 0.1
      ctx.fillStyle = this.colors.sel
      ctx.fillRect(x, y, w, h)
      ctx.globalAlpha = 1
      ctx.lineWidth = 1
      ctx.strokeStyle = this.colors.sel
      ctx.strokeRect(x + 0.5, y + 0.5, w, h)
    }
  }

  // Other players' pointers, each with their name in a tag of their colour.
  drawCursors() {
    const ctx = this.octx
    if (!ctx) return
    if (this.cursorsDrawn) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    }
    this.cursorsDrawn = this.cursors.size > 0
    if (!this.cursors.size) return
    const { dpr, cam, vw, vh } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.font = '600 11px system-ui, -apple-system, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (const c of this.cursors.values()) {
      const x = (c.x - cam.x) * cam.z + vw / 2
      const y = (c.y - cam.y) * cam.z + vh / 2
      if (x < -150 || y < -40 || x > vw + 10 || y > vh + 10) continue
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x, y + 16)
      ctx.lineTo(x + 4.2, y + 12.2)
      ctx.lineTo(x + 7.2, y + 18.6)
      ctx.lineTo(x + 9.6, y + 17.5)
      ctx.lineTo(x + 6.7, y + 11.2)
      ctx.lineTo(x + 12, y + 11.2)
      ctx.closePath()
      ctx.fillStyle = c.color
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#fff'
      ctx.stroke()
      const tw = ctx.measureText(c.name).width
      const lx = x + 12
      const ly = y + 18
      ctx.beginPath()
      ctx.roundRect(lx, ly, tw + 12, 18, 5)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.fillText(c.name, lx + 6, ly + 9.5)
    }
  }

  // Outline around the union of the given pieces (no inner seams): stroke every
  // outline, then punch the piece shapes back out.
  drawOutline(target, ids, color) {
    const { cam, dpr, vw, vh } = this
    const c = this.hlCtx
    const z = cam.z * dpr
    const place = (i) => {
      const [x, y, a] = this.pose(i)
      const co = Math.cos(a) * z
      const sn = Math.sin(a) * z
      const sx = this.f[i] ? -1 : 1
      c.setTransform(co * sx, sn * sx, -sn, co, ((x - cam.x) * cam.z + vw / 2) * dpr, ((y - cam.y) * cam.z + vh / 2) * dpr)
    }
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, this.hlLayer.width, this.hlLayer.height)
    c.lineJoin = 'round'
    c.strokeStyle = color
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
    target.setTransform(1, 0, 0, 1, 0, 0)
    target.drawImage(this.hlLayer, 0, 0)
  }

  drawPiece(ctx, i, x, y, a, s, sc) {
    const { sp, sx, lift } = this.face(i)
    if (!sp) return
    const { cam, dpr, vw, vh } = this
    const z = cam.z * dpr * s * lift
    const c = Math.cos(a) * z
    const sn = Math.sin(a) * z
    ctx.setTransform(c * sx, sn * sx, -sn, c, ((x - cam.x) * cam.z + vw / 2) * dpr, ((y - cam.y) * cam.z + vh / 2) * dpr)
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
