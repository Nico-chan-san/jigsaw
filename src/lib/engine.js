// Imperative canvas engine: rendering, camera, dragging, rotation and snapping.
import { buildPuzzle, outlinePath, pack, packExtent, pile, scatter, unitCells } from './geometry.js'
import { drawBack, drawFront, levels, spriteSize } from './sprites.js'

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
// The burst where two pieces join: how long it lasts, after waiting for the pieces to land.
const POP_MS = 520
const POP_DELAY = 80
const MAX_POPS = 12
const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)')
// The size of an empty tray, in piece sizes.
const TRAY_W = 6
const TRAY_H = 4
// Tray colours, by the name stored with each tray.
export const TRAY_COLORS = {
  blue: '#3b82f6',
  green: '#22a06b',
  yellow: '#e0a800',
  orange: '#f97316',
  red: '#e5484d',
  purple: '#8e4ec6',
  gray: '#8b8d98',
}
const CLICK_PX = 5
const CLICK_MS = 400
// Largest side of the cached sprite for a lifted selection.
const LIFT_MAX = 3000
// Modules of at least this many pieces turning on the table are drawn as one picture, see turnSprite().
const TURN_SPRITE = 8
// Above this many pieces a selection outline is built from piece silhouettes instead of stroked paths.
const OUTLINE_PATHS = 120
// Screen-space size of reference image handles.
const HANDLE = 7
// Cursor updates are throttled to this interval (ms); idle cursors vanish after CURSOR_IDLE.
const CURSOR_MS = 50
const CURSOR_IDLE = 20000
// The stacked layers (see syncLayer) are drawn this much bigger than the view on every side, as a
// share of the view's short side, so panning a little doesn't redraw them.
const OVERSCAN = 0.25
// While zooming, the layers are scaled instead of redrawn until the zoom has rested this long (ms)
// or they have been scaled up this much.
const ZOOM_SETTLE = 150
const ZOOM_STRETCH = 1.25
// While zooming, the layers that do get redrawn get at most this many pixels per CSS pixel.
const ZOOM_DPR = 1
// Canvases are never drawn finer than this many pixels per CSS pixel.
const MAX_DPR = 2
const makeCanvas = (w, h) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}
// Arrow keys and WASD move the camera, at this many screen pixels per second, speeding up the
// longer they are held: up to PAN_BOOST times as fast after PAN_RAMP ms.
const PAN_SPEED = 900
const PAN_BOOST = 3.5
const PAN_RAMP = 1500
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
  constructor(canvas, { room, image, pieces, refs, trays, overlay, user, userName, nameOf, guard, tooltip, send, onStats, onComplete, onRef, onRefDelete, onTray, onTrayDelete, onSnap }) {
    this.canvas = canvas
    // The board canvas only holds what changes from frame to frame: pieces in motion, the lifted
    // pieces, the hover outline, image handles and the selection box. The rest of the table (the
    // scene) sits on a canvas stacked under it and the selection outline on one over it, each
    // redrawn only when it changes, see syncLayer(). The browser stacks them for free.
    this.ctx = canvas.getContext('2d')
    this.sceneL = this.makeLayer(true)
    this.sceneVer = 0
    this.selL = this.makeLayer(false)
    this.selVer = 0
    canvas.before(this.sceneL.el)
    canvas.after(this.selL.el)
    // The camera the board was last drawn for, and a counter of frames drawn.
    this.mv = { x: NaN, y: NaN, z: NaN, w: NaN, h: NaN }
    this.frameNo = 0
    this.zoomedAt = 0
    // Pieces drawn on the board instead of in the scene, see updateActive().
    this.active = new Set()
    // The lifted pieces drawn one by one, for their shadow while they can't come from one sprite.
    // Sized to the board when first needed.
    this.layer = makeCanvas(0, 0)
    this.lctx = this.layer.getContext('2d')
    // The hover outline, sized to the piece.
    this.hlLayer = makeCanvas(0, 0)
    this.hlCtx = this.hlLayer.getContext('2d')
    this.hitCtx = makeCanvas(1, 1).getContext('2d')
    // Silhouettes of the pieces being outlined, sized to them, see outlineMasks().
    this.maskLayer = makeCanvas(0, 0)
    this.maskCtx = this.maskLayer.getContext('2d')
    // Other players' cursors go on a separate canvas stacked above the notes.
    this.overlay = overlay
    this.octx = overlay?.getContext('2d')
    // Low resolution buffer for the lifted pieces' drop shadow, and the blurred shadow of the lift
    // sprite, kept while neither changes much.
    this.shadowLayer = makeCanvas(0, 0)
    this.shCtx = this.shadowLayer.getContext('2d')
    this.liftShadow = null
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
    this.onStats = onStats
    // Pieces just connected, by this player (local) or another: onSnap({ seams, local }). The sound ignores seams.
    this.onSnap = onSnap
    this.onComplete = onComplete
    // Reference image changes: onRef(ref, live) while and after editing, onRefDelete(id).
    this.onRef = onRef
    this.onRefDelete = onRefDelete
    // Tray changes: onTray(tray, live) while and after moving it, onTrayDelete(id).
    this.onTray = onTray
    this.onTrayDelete = onTrayDelete
    // Called with (cam, vw, vh) whenever the view changes, see addView().
    this.views = new Set()
    this.viewsVer = 0

    this.geo = buildPuzzle(room)
    const n = (this.n = room.cols * room.rows)
    // Long pieces: per cell, the cell its piece starts at (null if every cell is its own piece), and
    // the cells of each long piece by that first cell. The cells of a long piece are joined from the
    // start and act as one piece.
    this.unit = this.geo.unit
    this.longs = unitCells(this.unit)
    this.paths = this.geo.pieces.map((p) => outlinePath(p.outline))
    this.x = new Float64Array(n)
    this.y = new Float64Array(n)
    this.r = new Int8Array(n)
    this.g = new Int32Array(n)
    this.by = new Array(n).fill(null)
    // Face down pieces (hardcore mode), their back sprites (like sprites below), and flips in
    // progress: i -> start time.
    this.f = new Uint8Array(n)
    this.backs = new Array(n)
    // Plain filled outlines of the pieces, made the first time a piece is outlined.
    this.masks = new Array(n)
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
    // Images, notes and trays riding along with a drag: { pointer, wx, wy, sx0, sy0, moved, note, refs,
    // notes, trays }. A moved tray also has lift: the pieces in it, picked up once the pointer moves.
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
    // Every sprite has the same size, and is drawn at this size in world units.
    const [spw, sph] = spriteSize(this.geo, this.margin, this.spriteScale)
    this.spriteW = spw / this.spriteScale
    this.spriteH = sph / this.spriteScale
    // Per piece: its sprite and halved copies of it (see levels()), made in the background.
    this.sprites = new Array(n)
    this.built = 0

    // Reference images, shared by the room: { id, x, y, w, author } in world units (centre and width).
    this.refs = (refs || []).filter((r) => isFinite(r.x) && isFinite(r.y) && r.w > 0)
    this.refSel = null
    this.refDrag = null

    // Trays, shared by the room: { id, x, y, w, h, color, pieces, author } in world units, x and y
    // being the top left corner. pieces lists the pieces in it, which it fits itself around. The last
    // one is on top. One can be selected: space and G then work on its pieces, Delete removes it.
    this.trays = (trays || [])
      .filter((t) => isFinite(t.x) && isFinite(t.y) && t.w > 0 && t.h > 0)
      .map((t) => ({ ...t, pieces: Array.isArray(t.pieces) ? t.pieces : [] }))
    this.traySel = null
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

    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
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
    // When the pan keys were first pressed, for speeding up while held.
    this.panSince = 0
    // View mode: the left button (and a finger) moves the table instead of pieces or selecting.
    this.panMode = false
    this.held = new Map()
    this.moving = new Map()
    // Bursts where pieces just joined: { x, y, t0, a } in world units.
    this.pops = []
    this.colors = { bg: '#f4f4f4', dot: 'rgba(0,0,0,.12)', shadow: 'rgba(0,0,0,.35)', sel: '#2f6fed' }
    this.last = performance.now()
    this.lastLive = 0

    // Whether the jigsaw is finished, so finishing it is only noticed once.
    this.done = this.isComplete()

    this.bind()
    this.resize()
    this.startSprites()
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
      // No context menu on the table, nor anywhere while something is being dragged (a right or
      // shift + right click mid drag lands on whatever is under the pointer, not always the table).
      menu: (e) => {
        if (e.target === c || this.drag || this.pan || this.marquee || this.refDrag) e.preventDefault()
      },
      // The browser's own drag and drop (of a page selection, say) never starts from the table.
      nodrag: (e) => e.preventDefault(),
      // The canvas position is cached (see pos()); scrolling or resizing the window can move it.
      moved: () => {
        this.rect = this.canvas.getBoundingClientRect()
      },
    }
    c.addEventListener('pointerdown', this.h.down)
    c.addEventListener('pointermove', this.h.move)
    c.addEventListener('pointerup', this.h.up)
    c.addEventListener('pointercancel', this.h.up)
    c.addEventListener('pointerleave', this.h.leave)
    c.addEventListener('wheel', this.h.wheel, { passive: false })
    window.addEventListener('contextmenu', this.h.menu, true)
    this.host = c.parentElement
    this.host?.addEventListener('dragstart', this.h.nodrag)
    window.addEventListener('keydown', this.h.key)
    window.addEventListener('keyup', this.h.keyup)
    window.addEventListener('blur', this.h.stopPan)
    window.addEventListener('pointermove', this.h.track, true)
    document.documentElement.addEventListener('pointerleave', this.h.gone)
    window.addEventListener('blur', this.h.gone)
    window.addEventListener('scroll', this.h.moved, { capture: true, passive: true })
    window.addEventListener('resize', this.h.moved)
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
    window.removeEventListener('contextmenu', this.h.menu, true)
    this.host?.removeEventListener('dragstart', this.h.nodrag)
    window.removeEventListener('keydown', this.h.key)
    window.removeEventListener('keyup', this.h.keyup)
    window.removeEventListener('blur', this.h.stopPan)
    window.removeEventListener('pointermove', this.h.track, true)
    document.documentElement.removeEventListener('pointerleave', this.h.gone)
    window.removeEventListener('blur', this.h.gone)
    window.removeEventListener('scroll', this.h.moved, { capture: true })
    window.removeEventListener('resize', this.h.moved)
    this.ro.disconnect()
    cancelAnimationFrame(this.raf)
    this.raf = -1
    this.spriteHost?.terminate()
    this.spriteWorker = this.spriteHost = null
    clearTimeout(this.zoomTimer)
    clearTimeout(this.heldTimer)
    this.sceneL.el.remove()
    this.selL.el.remove()
  }

  resize() {
    const rect = (this.rect = this.canvas.getBoundingClientRect())
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
    this.vw = Math.max(1, rect.width)
    this.vh = Math.max(1, rect.height)
    for (const c of [this.canvas, this.overlay]) {
      if (!c) continue
      c.width = Math.round(this.vw * this.dpr)
      c.height = Math.round(this.vh * this.dpr)
    }
    // Only drawn into while needed, and sized then.
    this.layer.width = this.layer.height = 0
    this.liftBox = null
    this.invalidate()
  }

  // A canvas stacked with the board, holding a picture that is slow to draw, see syncLayer().
  // The scene is opaque, which makes it cheaper to draw and stack.
  makeLayer(opaque) {
    const el = document.createElement('canvas')
    el.className = 'layer'
    el.style.visibility = 'hidden'
    return { el, ctx: el.getContext('2d', { alpha: !opaque }), v: null, key: null, tf: '', hidden: true }
  }

  // Brings a stacked layer up to date with the camera. A layer is drawn for one camera, a margin
  // bigger than the view on every side, and panning or zooming just moves and scales the element
  // (the browser does that without redrawing anything) until the picture no longer covers the
  // view, gets scaled up too far or the zoom has come to rest. Only then, or when key changes, is
  // it drawn again, with draw(ctx, view). A view is { x, y, z, w, h }: the world point at its
  // middle, the zoom and its size in CSS pixels.
  //
  // While the zoom changes, a layer that has to be redrawn is drawn at ZOOM_DPR pixels per CSS pixel
  // at most, and sharp again once the zoom rests: browsers that draw canvases on the CPU (Firefox)
  // can't redraw a whole screen of pieces at full resolution several times a second. A lazy layer
  // (the selection outline) isn't redrawn at all while the zoom changes, only scaled, even if it
  // no longer covers the view.
  syncLayer(L, key, draw, lazy = false) {
    const { cam, vw, vh } = this
    const zooming = performance.now() - this.zoomedAt <= ZOOM_SETTLE
    let v = L.v
    let k = 1
    let ax = 0
    let ay = 0
    const place = () => {
      k = cam.z / v.z
      ax = vw / 2 - (v.w / 2) * k + (v.x - cam.x) * cam.z
      ay = vh / 2 - (v.h / 2) * k + (v.y - cam.y) * cam.z
    }
    let stale = !v || L.key !== key || (!zooming && v.dpr !== this.dpr)
    if (!stale) {
      place()
      const covers = ax <= 0.5 && ay <= 0.5 && ax + v.w * k >= vw - 0.5 && ay + v.h * k >= vh - 0.5
      stale = zooming ? !lazy && (!covers || k > ZOOM_STRETCH) : k !== 1 || !covers
    }
    if (stale) {
      const dpr = zooming ? Math.min(this.dpr, ZOOM_DPR) : this.dpr
      const m = Math.round(Math.min(vw, vh) * OVERSCAN)
      const W = Math.ceil((vw + 2 * m) * dpr)
      const H = Math.ceil((vh + 2 * m) * dpr)
      if (L.el.width !== W || L.el.height !== H) {
        L.el.width = W
        L.el.height = H
        L.el.style.width = `${W / dpr}px`
        L.el.style.height = `${H / dpr}px`
      }
      v = L.v = { x: cam.x, y: cam.y, z: cam.z, w: W / dpr, h: H / dpr, dpr }
      L.key = key
      // Everything drawing a layer reads this.dpr.
      const full = this.dpr
      this.dpr = dpr
      try {
        draw(L.ctx, v)
      } finally {
        this.dpr = full
      }
      place()
    }
    // Unscaled, the layer sits on whole device pixels so it stays sharp.
    if (k === 1) {
      ax = Math.round(ax * v.dpr) / v.dpr
      ay = Math.round(ay * v.dpr) / v.dpr
    }
    const tf = `translate(${ax}px, ${ay}px) scale(${k})`
    if (tf !== L.tf) {
      L.tf = tf
      L.el.style.transform = tf
    }
    if (L.hidden) {
      L.hidden = false
      L.el.style.visibility = ''
    }
  }

  hideLayer(L) {
    if (L.hidden) return
    L.hidden = true
    L.v = null
    L.el.style.visibility = 'hidden'
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

  // Calls fn(cam, vw, vh) now and whenever the view changes. Returns a function that stops it.
  addView(fn) {
    this.views.add(fn)
    this.viewsVer++
    this.invalidate(false)
    return () => {
      this.views.delete(fn)
      this.viewsVer++
    }
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
    this.invalidate(false)
  }

  // Eases the zoom around the middle of the view. Presses during the animation add up.
  zoomBy(f) {
    const a = this.camAnim
    const from = a?.zoom ? a.to : this.cam
    const z = Math.min(this.zmax, Math.max(this.zmin, from.z * f))
    this.camAnim = { from: { ...this.cam }, to: { x: from.x, y: from.y, z }, t0: performance.now(), ms: 260, zoom: true }
    this.invalidate(false)
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
    this.invalidate(false)
  }

  fit(animate = true) {
    this.frame(this.bbox(this.order), 0.82, animate)
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
    for (let i = 0; i < this.n; i++) if (this.by[i] && (!this.unit || this.unit[i] === i)) get(this.by[i]).pieces++
    return m
  }

  // The cells of the piece cell i is part of: just i, or all of a long piece.
  cellsOf(i) {
    return (this.unit && this.longs.get(this.unit[i])) || [i]
  }

  // Whether these cells are one piece: a single cell, or the cells of one long piece.
  onePiece(list) {
    if (list.length === 1) return true
    const u = this.unit
    return !!u && list.length === this.cellsOf(list[0]).length && list.every((i) => u[i] === u[list[0]])
  }

  members(gid) {
    const out = []
    for (let i = 0; i < this.n; i++) if (this.g[i] === gid) out.push(i)
    return out
  }

  emitStats() {
    clearTimeout(this.statsTimer)
    this.statsTimer = setTimeout(() => this.onStats?.(), 120)
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

  // The selected pieces that nobody else is holding right now. A selected tray counts as selecting
  // its pieces (without outlining them), so space and G work on them too. With loose, groups that
  // are in a tray are left out, so turning or sorting a selection leaves the trays as they are.
  freeSelection(loose = false) {
    const now = performance.now()
    if (!this.sel.size && this.traySel) {
      const t = this.trays.find((x) => x.id === this.traySel)
      return t ? this.trayPieces(t) : []
    }
    const ids = [...this.withGroups(this.sel)].filter((i) => !(this.held.get(i) > now))
    if (!loose || !this.trays.some((t) => t.pieces.length)) return ids
    const inTray = new Set(this.trays.flatMap((t) => t.pieces))
    const skip = new Set(ids.filter((i) => inTray.has(i)).map((i) => this.g[i]))
    return ids.filter((i) => !skip.has(this.g[i]))
  }

  // Ends any movement animation on these pieces, so they sit where they are headed.
  settle(ids) {
    for (const i of ids) {
      const to = this.moving.get(i)
      if (to) [this.x[i], this.y[i]] = to
      this.moving.delete(i)
    }
  }

  // Where piece i is drawn on the table, including a turn in progress: sets this.qx, this.qy and
  // this.qa (the angle). Kept in fields so drawing thousands of pieces allocates nothing.
  poseInto(i) {
    const t = this.turns.size ? this.turns.get(i) : undefined
    if (!t) {
      this.qx = this.x[i]
      this.qy = this.y[i]
      this.qa = this.r[i] * Q
      return
    }
    const dx = this.x[i] - t.cx
    const dy = this.y[i] - t.cy
    const c = Math.cos(t.a)
    const s = Math.sin(t.a)
    this.qx = t.cx + dx * c - dy * s
    this.qy = t.cy + dx * s + dy * c
    this.qa = this.r[i] * Q + t.a
  }

  setSelection(set, refs = new Set(), notes = new Set()) {
    const same = (a, b) => a.size === b.size && [...a].every((v) => b.has(v))
    this.sel = set
    this.selVer++
    // Selected images are outlined in the scene; pieces have their own layer.
    const sameRefs = same(refs, this.selRefs)
    this.selRefs = refs
    if (!same(notes, this.selNotes)) this.notes?.select(notes)
    this.selNotes = notes
    this.invalidate(!sameRefs)
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
      trays: [],
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
      trays: c.trays.map((t) => ({ id: t.id, x: t.x + dx, y: t.y + dy })),
    }
  }

  // Each carried tray, where it is now.
  carriedTrays(list) {
    return list.map((p) => this.trays.find((t) => t.id === p.id)).filter(Boolean)
  }

  moveCarry(wx, wy) {
    const c = this.carry
    if (!c) return
    c.at = [wx, wy]
    const { refs, notes, trays } = this.carryAt(wx, wy)
    for (const p of refs) {
      const ref = this.refs.find((r) => r.id === p.id)
      if (ref) Object.assign(ref, p)
    }
    for (const p of trays) {
      const t = this.trays.find((x) => x.id === p.id)
      if (t) Object.assign(t, p)
    }
    if (notes.length) this.notes?.move(notes, null)
    this.sendCarry()
    this.invalidate(!!refs.length || !!trays.length)
  }

  sendCarry(force) {
    const now = performance.now()
    clearTimeout(this.carryTimer)
    const c = this.carry
    if (!c?.at) return
    if (force || now - (this.lastCarry || 0) >= LIVE_MS) {
      this.lastCarry = now
      const { refs, notes, trays } = this.carryAt(...c.at)
      for (const p of refs) {
        const ref = this.refs.find((r) => r.id === p.id)
        if (ref) this.onRef?.(ref, true)
      }
      for (const t of this.carriedTrays(trays)) this.onTray?.(t, true)
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
    // A click on a selected note without moving selects just that note.
    if (!c.moved && c.note) return this.notes?.click(c.note)
    if (!c.at) return
    const { refs, notes, trays } = this.carryAt(...c.at)
    for (const p of refs) {
      const ref = this.refs.find((r) => r.id === p.id)
      if (ref) this.onRef?.(ref, false)
    }
    for (const t of this.carriedTrays(trays)) this.onTray?.(t, false)
    if (notes.length) this.notes?.move(notes, 'save')
  }

  // Sprites are drawn in a worker when the browser can, and sent back as ImageBitmaps (which are
  // also quicker to draw). Otherwise, or if the worker fails, render() builds them here a slice of
  // a frame at a time. The worker is kept until destroy(), even when done: Chrome frees the bitmaps
  // it made when it ends. this.spriteWorker is set only while it is still sending sprites.
  startSprites() {
    // Backs are only ever needed for pieces that are face down now: pieces never turn back over.
    this.backQueue = []
    for (let i = 0; i < this.n; i++) if (this.f[i]) this.backQueue.push(i)
    this.buildAt = 0
    this.spriteWorker = null
    if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') return
    let worker
    try {
      worker = new Worker(new URL('./sprites.worker.js', import.meta.url), { type: 'module' })
    } catch {
      return
    }
    this.spriteWorker = this.spriteHost = worker
    const stop = () => {
      if (this.spriteWorker === worker) this.spriteWorker = null
      this.invalidate(false)
    }
    worker.onmessage = ({ data }) => {
      if (this.spriteWorker !== worker) return
      if (data.kind === 'front') {
        for (const { i, lv } of data.items) {
          if (!this.sprites[i]) this.built++
          this.sprites[i] = lv
        }
        this.invalidate()
      } else if (data.kind === 'back') {
        for (const { i, lv } of data.items) this.backs[i] ??= lv
      } else if (data.kind === 'done') {
        this.backQueue = []
        stop()
      } else stop()
    }
    worker.onerror = stop
    createImageBitmap(this.image)
      .then((image) => {
        if (this.spriteWorker !== worker) return
        const msg = { room: this.room, image, margin: this.margin, sc: this.spriteScale, backs: this.backQueue }
        worker.postMessage(msg, [image])
      })
      .catch(stop)
  }

  // Main thread fallback: builds sprites until the deadline, fronts first.
  buildSome(until) {
    while (this.buildAt < this.n && performance.now() < until) {
      const i = this.buildAt++
      if (this.sprites[i]) continue
      this.sprites[i] = levels(this.makeSprite(i), makeCanvas)
      this.built++
    }
    while (this.buildAt >= this.n && this.backQueue.length && performance.now() < until) {
      const i = this.backQueue.pop()
      this.backs[i] ??= levels(this.makeBack(i), makeCanvas)
    }
  }

  spriteOpts() {
    return { geo: this.geo, room: this.room, image: this.image, margin: this.margin, sc: this.spriteScale }
  }

  makeSprite(i) {
    const c = makeCanvas(...spriteSize(this.geo, this.margin, this.spriteScale))
    drawFront(c.getContext('2d'), this.spriteOpts(), this.geo.pieces[i], this.paths[i])
    return c
  }

  // The piece's shape filled solid, with no shadow, at the same size as its sprite.
  makeMask(i) {
    const sc = this.spriteScale
    const c = makeCanvas(...spriteSize(this.geo, this.margin, sc))
    const ctx = c.getContext('2d')
    ctx.setTransform(sc, 0, 0, sc, c.width / 2, c.height / 2)
    ctx.fill(this.paths[i])
    return c
  }

  // The back of a piece: plain cardboard in the same outline. It is drawn mirrored, see face().
  makeBack(i) {
    const c = makeCanvas(...spriteSize(this.geo, this.margin, this.spriteScale))
    drawBack(c.getContext('2d'), this.spriteOpts(), this.geo.pieces[i], this.paths[i])
    return c
  }

  // What to draw for piece i: returns its sprite levels (or nothing yet), and sets this.fsx to the
  // horizontal scale in the piece's own frame and this.flift to an extra lift. Face down pieces are
  // mirrored (fsx = -1), as a real piece turned over is. A flip in progress squeezes the piece
  // through its edge and swaps sprites halfway.
  face(i, still = false) {
    let sx = this.f[i] ? -1 : 1
    let lift = 1
    const t0 = still || !this.flips.size ? undefined : this.flips.get(i)
    if (t0 !== undefined) {
      const p = Math.min(1, (performance.now() - t0) / FLIP_MS)
      const e = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p)
      sx = -sx * Math.cos(Math.PI * e)
      lift = 1 + 0.18 * Math.sin(Math.PI * e)
    }
    this.fsx = sx
    this.flift = lift
    return sx >= 0 ? this.sprites[i] : (this.backs[i] ??= levels(this.makeBack(i), makeCanvas))
  }

  // The smallest of a sprite's levels that still has at least `need` pixels per world unit.
  pick(lv, need) {
    let k = 0
    let s = this.spriteScale / 2
    while (k + 1 < lv.length && s >= need) {
      k++
      s /= 2
    }
    return lv[k]
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

  // Reading the canvas position on every pointer event would force a layout whenever the page
  // changed in between (the tooltip, the notes), so it is cached, see resize() and h.moved.
  pos(e) {
    const r = this.rect
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
      this.invalidate(false)
      return
    }
    // Right (or middle) button drags the table, as does any press in view mode.
    if (e.button === 1 || e.button === 2 || (this.panMode && e.button === 0)) return this.startPan(e.pointerId, sx, sy)
    if (e.button !== 0) return

    const [wx, wy] = this.toWorld(sx, sy)
    const rh = this.refHit(sx, sy)
    const th = rh ? null : this.trayHit(sx, sy)
    const i = rh && rh.mode !== 'move' ? -1 : this.hit(wx, wy)
    if (i >= 0) {
      if (this.held.get(i) > performance.now()) return
      if (this.guard && !this.guard()) return
      this.selectRef(null)
      this.selectTray(null)
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
    if (th) return this.startTrayDrag(th, e.pointerId, sx, sy, wx, wy)
    this.selectTray(null)
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
      // A tray starts moving: pick up its pieces, from where the press was, so they keep their place.
      if (c.moved && c.lift) {
        const l = c.lift
        c.lift = null
        if (l.ids.length) {
          this.startDrag(l.ids, l.wx, l.wy, c.pointer, l.sx, l.sy)
          // Not a click, so no piece gets turned over or selected.
          this.drag.moved = true
          // Lifted as if from the tray's middle: growing around the pointer would push the pieces
          // far from it out over the tray's edge.
          const t = this.trays.find((x) => x.id === c.trays[0].id)
          if (t) {
            this.lift.cx = c.trays[0].x + t.w / 2 - l.wx
            this.lift.cy = c.trays[0].y + t.h / 2 - l.wy
          }
        }
      }
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
      this.invalidate(false)
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
      const click = this.room.annoying && this.onePiece(d.ids) && !d.moved && performance.now() - d.t0 < CLICK_MS
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
      this.invalidate(false)
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
    // Most moves change nothing but the box itself, which is cheap to draw.
    const same = (a, b) => a.size === b.size && [...a].every((v) => b.has(v))
    if (same(next, this.sel) && same(refs, this.selRefs) && same(notes, this.selNotes)) return this.invalidate(false)
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
      this.selectTray(null)
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !this.refDrag && !this.drag && !this.carry) {
      if (!this.refSel && !this.traySel && !this.selRefs.size && !this.selNotes.size) return
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
      return key === ' ' ? this.spin(1, e.shiftKey) : this.gather(e.shiftKey)
    }
    // With a selection on the table (or a tray selected), space turns the pieces where they lie
    // (shift: all as one) and G sorts them into a grid (shift: in random order).
    if ((key === ' ' || key === 'g') && (this.sel.size || this.traySel)) {
      e.preventDefault()
      if (!e.repeat) key === 'g' ? this.sortSelection(e.shiftKey) : this.rotateSelection(1, e.shiftKey)
    }
  }

  // Groups only form through grid neighbours, so a piece is connected iff a neighbour shares its
  // group. The other cells of a long piece don't count: they came that way.
  connected(i) {
    const { cols, rows } = this.room
    const c = i % cols
    const g = this.g[i]
    const u = this.unit
    const joined = (q) => this.g[q] === g && (!u || u[q] !== u[i])
    return (c > 0 && joined(i - 1)) || (c < cols - 1 && joined(i + 1)) || (i >= cols && joined(i - cols)) || (i < (rows - 1) * cols && joined(i + cols))
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
    const th = rh ? null : this.trayHit(sx, sy)
    const i = rh && rh.mode !== 'move' ? -1 : this.hit(wx, wy)
    this.canvas.style.cursor = this.cursorFor(i, rh, th)
    let hl = null
    if (i >= 0 && this.by[i] && this.connected(i)) {
      const ids = this.cellsOf(i)
      hl = { key: `p:${ids[0]}`, ids, text: this.nameOf(this.by[i]) }
    }
    this.setHighlight(hl)
    // Hovering a reference image (not covered by a piece) shows who put it there.
    const text = hl ? hl.text : i < 0 && rh?.ref.author ? this.nameOf(rh.ref.author) : null
    this.showTip(text ? { text, sx, sy } : null)
  }

  // The pointer over a piece (i), an image's handles (rh) or a tray's name strip (th).
  cursorFor(i, rh, th) {
    if (i >= 0) return 'grab'
    if (th) return 'move'
    if (!rh) return ''
    if (rh.mode === 'resize') return rh.cx === rh.cy ? 'nwse-resize' : 'nesw-resize'
    return 'move'
  }

  setHighlight(hl) {
    if (hl?.key === this.hl?.key) return
    this.hl = hl
    this.invalidate(false)
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
    const w = this.spriteW
    const h = this.spriteH
    for (let j = 0; j < d.ids.length; j++) {
      const lv = this.face(d.ids[j], true)
      if (!lv) continue
      const sx = this.fsx
      const a = d.r0[j] * Q
      const co = Math.cos(a) * res
      const sn = Math.sin(a) * res
      ctx.setTransform(co * sx, sn * sx, -sn, co, (d.ox[j] - x0) * res, (d.oy[j] - y0) * res)
      ctx.drawImage(this.pick(lv, res), -w / 2, -h / 2, w, h)
    }
    this.lift.sprite = { c, x0, y0, x1, y1, res, target: res }
    this.liftShadow = null
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

  get packExtent() {
    return packExtent(this.geo)
  }

  // G while holding several groups: pulls them together in a grid around the pointer, none overlapping.
  // With shuffle (shift), the groups go in random order.
  gather(shuffle = false) {
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
    const spots = pack(boxes, this.geo.S, shuffle)
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
    const g0 = this.g.slice()
    const changed = new Set()
    for (const m of mods) for (const j of this.snap(m)) changed.add(j)
    for (const i of changed) {
      if (this.x[i] === x0[i] && this.y[i] === y0[i]) continue
      this.moving.set(i, [this.x[i], this.y[i]])
      this.x[i] = x0[i]
      this.y[i] = y0[i]
    }
    this.joined(g0, changed, true)
    return changed
  }

  // After pieces moved (ids) and the groups were g0 before: finds every new seam, where two
  // neighbours that were apart are now in one group, and marks it with a burst and a sound.
  joined(g0, ids, local) {
    const { cols } = this.room
    const set = ids instanceof Set ? ids : new Set(ids)
    // Where a piece is going, if it's still easing there.
    const at = (i) => this.moving.get(i) || [this.x[i], this.y[i]]
    const seams = []
    for (const i of set) {
      const c = i % cols
      for (const q of [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, i - cols, i + cols]) {
        if (q < 0 || q >= this.n || this.g[q] !== this.g[i] || g0[q] === g0[i]) continue
        // Both moved: count the seam once.
        if (q < i && set.has(q)) continue
        const [x1, y1] = at(i)
        const [x2, y2] = at(q)
        seams.push([(x1 + x2) / 2, (y1 + y2) / 2])
      }
    }
    if (!seams.length) return
    this.onSnap?.({ seams: seams.length, local })
    if (calm?.matches) return
    // A long edge joining at once gets a few bursts spread along it, not one per seam.
    const step = Math.max(1, seams.length / MAX_POPS)
    const t0 = performance.now() + POP_DELAY
    for (let k = 0; k < seams.length; k += step) {
      const [x, y] = seams[Math.floor(k)]
      this.pops.push({ x, y, t0: t0 + (k / step) * 25, a: Math.random() * Math.PI })
    }
    this.invalidate(false)
  }

  // Space with a selection: turns each selected module a quarter around its centre, on the table.
  // With whole (shift), the selection turns as one around its common centre.
  rotateSelection(dir, whole = false) {
    if (this.guard && !this.guard()) return
    const ids = this.freeSelection(true)
    if (!ids.length) return
    this.settle(ids)
    const mods = this.modules(ids)
    for (const m of whole ? [ids] : mods) {
      const b = this.bbox(m, 0)
      const cx = (b.x0 + b.x1) / 2
      const cy = (b.y0 + b.y1) / 2
      // One turn for the whole module, so a big one can be drawn turning as one picture (see turnSprite).
      const t = { cx, cy, a: (this.turns.get(m[0])?.a || 0) - dir * Q, ids: m.length >= TURN_SPRITE ? m : null }
      for (const i of m) {
        const [rx, ry] = rot(this.x[i] - cx, this.y[i] - cy, dir)
        this.x[i] = cx + rx
        this.y[i] = cy + ry
        this.r[i] = mod4(this.r[i] + dir)
        this.flips.delete(i)
        this.turns.set(i, t)
      }
    }
    const changed = this.snapModules(mods)
    this.fitTraysOf(ids)
    this.commit(changed)
  }

  // Lays the selected modules out in a square grid, centred where the selection lies now.
  // With shuffle (shift), in random order rather than the order they lie in.
  sortSelection(shuffle = false) {
    if (this.guard && !this.guard()) return
    const ids = this.freeSelection(true)
    if (!ids.length) return
    this.settle(ids)
    const mods = this.modules(ids)
    const all = this.bbox(ids, 0)
    const cx = (all.x0 + all.x1) / 2
    const cy = (all.y0 + all.y1) / 2
    const boxes = mods.map((m) => this.bbox(m, this.packExtent))
    const spots = pack(boxes, this.geo.S, shuffle)
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
    this.fitTraysOf(ids)
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
    this.emitStats()
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
    const g0 = this.g.slice()
    const changed = new Set()
    for (const grp of this.modules(d.ids)) for (const j of this.snap(grp)) changed.add(j)
    this.joined(g0, changed, true)

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
    // Pieces carried along with their tray stay in it, wherever it's let go.
    const tray = this.carry?.trays[0] && this.trays.find((t) => t.id === this.carry.trays[0].id)
    this.placeInTrays(d.ids, d.px, d.py, tray)
    this.commit(changed)
  }

  // Turns a loose face down piece face up. It never goes back, so clicking a piece to select it is
  // safe. Pieces in a module are always face up, so they stay put.
  flip(i) {
    if (!this.f[i] || this.connected(i)) return
    // A long piece turns over as one.
    const cells = this.cellsOf(i)
    const now = performance.now()
    for (const k of cells) {
      this.f[k] = 0
      this.flips.set(k, now)
    }
    // The landing sprite still shows the old side; draw the piece itself so the flip is visible.
    if (this.lift?.set.has(i)) this.lift.sprite = null
    this.send({ type: 'moves', pieces: cells.map((k) => ({ i: k, x: this.x[k], y: this.y[k], r: this.r[k], g: this.g[k], f: this.f[k] })) })
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
    // A single piece (one cell, or a long piece) that gets connected is credited to this player
    // (kept forever); pieces already in a module keep their names.
    const credit = (list) => {
      if (!this.onePiece(list)) return
      for (const i of list) {
        if (this.by[i]) continue
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
    credit(target)
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

  // ---- dev tools (npm run dev only, see DevMenu.jsx) -----------------------

  // Puts pieces where they belong next to piece a, face up and turned like it. Returns where they
  // were, so they can ease over from there.
  devPlace(ids, a) {
    const { cols } = this.room
    const { w, h } = this.geo
    const from = ids.map((i) => [this.x[i], this.y[i]])
    const now = performance.now()
    for (const i of ids) {
      const [ex, ey] = rot(((i % cols) - (a % cols)) * w, (((i / cols) | 0) - ((a / cols) | 0)) * h, this.r[a])
      this.x[i] = this.x[a] + ex
      this.y[i] = this.y[a] + ey
      this.r[i] = this.r[a]
      if (this.f[i]) this.flips.set(i, now)
      this.f[i] = 0
      this.turns.delete(i)
    }
    return from
  }

  // Eases pieces from where they were (from, as devPlace returned) to where they are now.
  devEase(ids, from) {
    ids.forEach((i, k) => {
      this.moving.set(i, [this.x[i], this.y[i]])
      ;[this.x[i], this.y[i]] = from[k]
    })
  }

  // Joins two random neighbours that are apart: the smaller group moves onto the other.
  devConnect() {
    if (this.drag) return
    const { cols } = this.room
    const now = performance.now()
    const free = (i) => !(this.held.get(i) > now)
    const pairs = []
    for (let i = 0; i < this.n; i++) {
      if (!free(i)) continue
      if (i % cols < cols - 1 && this.g[i + 1] !== this.g[i] && free(i + 1)) pairs.push([i, i + 1])
      if (i + cols < this.n && this.g[i + cols] !== this.g[i] && free(i + cols)) pairs.push([i, i + cols])
    }
    if (!pairs.length) return
    let [p, q] = pairs[Math.floor(Math.random() * pairs.length)]
    if (this.members(this.g[p]).length > this.members(this.g[q]).length) [p, q] = [q, p]
    const ids = this.members(this.g[p])
    this.settle([...ids, ...this.members(this.g[q])])
    const from = this.devPlace(ids, q)
    const changed = this.snapModules([ids])
    this.devEase(ids, from)
    this.toTop(new Set(ids))
    this.placeInTrays(ids, this.x[q], this.y[q], this.trays.find((t) => t.pieces.includes(q)) || null)
    this.commit(changed)
  }

  // Puts every piece in place around the biggest group, finishing the jigsaw.
  devSolve() {
    if (this.drag || this.isComplete()) return
    const sizes = new Map()
    for (let i = 0; i < this.n; i++) sizes.set(this.g[i], (sizes.get(this.g[i]) || 0) + 1)
    const big = [...sizes].reduce((a, b) => (b[1] > a[1] ? b : a))[0]
    const ids = []
    for (let i = 0; i < this.n; i++) if (this.g[i] !== big) ids.push(i)
    const all = Array.from({ length: this.n }, (_, i) => i)
    this.settle(all)
    const from = this.devPlace(ids, big)
    const g0 = this.g.slice()
    this.g.fill(0)
    this.joined(g0, ids, true)
    this.devEase(ids, from)
    this.toTop(new Set(ids))
    this.commit(all)
  }

  // Starts the jigsaw over: every piece apart and laid out afresh, as a new jigsaw would be, nobody
  // credited for anything and the trays emptied.
  devRestart() {
    if (this.drag) return
    const layout = (this.room.annoying ? pile : scatter)(this.room, (Math.random() * 2 ** 31) | 0)
    const now = performance.now()
    this.turns.clear()
    this.held.clear()
    this.remote.clear()
    for (const p of layout) {
      this.moving.set(p.i, [p.x, p.y])
      this.r[p.i] = p.r
      this.g[p.i] = p.g
      this.by[p.i] = null
      if ((p.f ? 1 : 0) !== this.f[p.i]) this.flips.set(p.i, now)
      this.f[p.i] = p.f ? 1 : 0
    }
    this.setSelection(new Set())
    const full = this.trays.filter((t) => t.pieces.length)
    for (const t of full) t.pieces = []
    this.refitTrays(full)
    this.sceneVer++
    this.commit(layout.map((p) => p.i))
    setTimeout(() => this.fit(), 250)
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
    // Held pieces are drawn on the board, not in the scene.
    this.invalidate(false)
  }

  applyRemote(list) {
    const g0 = this.g.slice()
    const touched = new Set()
    for (const p of list) {
      if (this.drag?.set.has(p.i)) continue
      this.held.delete(p.i)
      this.moving.set(p.i, [p.x, p.y])
      this.r[p.i] = p.r
      this.g[p.i] = p.g
      if (p.by !== undefined) this.by[p.i] = p.by
      if (p.f !== undefined && p.f !== null && (p.f ? 1 : 0) !== this.f[p.i]) {
        this.f[p.i] = p.f ? 1 : 0
        this.flips.set(p.i, performance.now())
      }
      touched.add(p.i)
    }
    if (touched.size) this.toTop(touched)
    if (this.sel.size) this.sel = this.withGroups(this.sel)
    this.joined(g0, touched, false)
    this.emitStats()
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
  }

  // Delete or Backspace: removes the selected images, notes and tray (pieces stay).
  removeSelected() {
    if (this.guard && !this.guard()) return
    const refs = new Set(this.selRefs)
    if (this.refSel) refs.add(this.refSel)
    const notes = [...this.selNotes]
    if (this.traySel) this.removeTray(this.traySel)
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
    this.invalidate()
  }

  // Another player added, moved or resized an image.
  remoteRef(ref) {
    if (this.refDrag?.ref.id === ref.id || this.carry?.refs.some((r) => r.id === ref.id)) return
    const cur = this.refs.find((r) => r.id === ref.id)
    if (cur) Object.assign(cur, ref)
    else this.refs.push(ref)
    this.invalidate()
  }

  setRefs(refs) {
    const dragging = this.refDrag?.ref
    this.refs = refs.map((r) => (dragging && r.id === dragging.id ? dragging : r))
    if (this.refSel && !this.refs.some((r) => r.id === this.refSel)) this.refSel = null
    for (const id of this.selRefs) if (!this.refs.some((r) => r.id === id)) this.selRefs.delete(id)
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
    this.invalidate(false)
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

  // ---- trays ----------------------------------------------------------------

  // Adds a tray in a random colour (one no other tray has, while there are some left). With pieces
  // selected, it's made around them, taking them out of any tray they were in. Otherwise it's empty,
  // centred on a canvas point or the middle of the view.
  addTray(sx = this.vw / 2, sy = this.vh / 2) {
    if (this.guard && !this.guard()) return
    const ids = this.sel.size ? this.freeSelection() : []
    const [x, y] = this.toWorld(sx, sy)
    const w = this.geo.S * TRAY_W
    const h = this.geo.S * TRAY_H
    const keys = Object.keys(TRAY_COLORS)
    const used = new Set(this.trays.map((t) => t.color))
    const free = keys.filter((k) => !used.has(k))
    const pick = free.length ? free : keys
    const color = pick[Math.floor(Math.random() * pick.length)]
    const tray = {
      id: Math.random().toString(36).slice(2, 10),
      x: x - w / 2,
      y: y - h / 2,
      w,
      h,
      color,
      pieces: [],
      author: this.user || '',
    }
    const left = []
    if (ids.length) {
      const moved = new Set(ids)
      for (const t of this.trays) {
        if (!t.pieces.some((i) => moved.has(i))) continue
        t.pieces = t.pieces.filter((i) => !moved.has(i))
        left.push(t)
      }
      tray.pieces = ids
      this.fitTray(tray)
    }
    this.trays.push(tray)
    this.refitTrays(left)
    if (this.selCount) this.setSelection(new Set())
    this.selectRef(null)
    this.selectTray(tray.id)
    this.onTray?.(tray, false)
  }

  selectTray(id) {
    if (this.traySel === id) return
    this.traySel = id
    this.invalidate()
  }

  removeTray(id, remote = false) {
    if (!remote && this.guard && !this.guard()) return
    this.trays = this.trays.filter((t) => t.id !== id)
    if (this.traySel === id) this.traySel = null
    if (this.carry) this.carry.trays = this.carry.trays.filter((t) => t.id !== id)
    if (!remote) this.onTrayDelete?.(id)
    this.invalidate()
  }

  // Another player added, moved or filled a tray.
  remoteTray(tray) {
    if (this.carry?.trays.some((t) => t.id === tray.id)) return
    const cur = this.trays.find((t) => t.id === tray.id)
    if (cur) Object.assign(cur, tray)
    else this.trays.push({ ...tray, pieces: tray.pieces || [] })
    this.invalidate()
  }

  setTrays(trays) {
    this.trays = trays.map((t) => ({ ...t, pieces: t.pieces || [] }))
    if (this.traySel && !this.trays.some((t) => t.id === this.traySel)) this.traySel = null
    this.invalidate()
  }

  // The topmost tray under a canvas point (pieces on it come first, see onDown).
  trayHit(sx, sy) {
    const [wx, wy] = this.toWorld(sx, sy)
    for (let k = this.trays.length - 1; k >= 0; k--) {
      const t = this.trays[k]
      if (wx >= t.x && wx <= t.x + t.w && wy >= t.y && wy <= t.y + t.h) return { tray: t }
    }
    return null
  }

  // The pieces to carry with a tray: its own, with the rest of their groups, less any that someone
  // else is holding.
  trayPieces(t) {
    const now = performance.now()
    return [...this.withGroups(t.pieces)].filter((i) => !(this.held.get(i) > now))
  }

  // Where a piece is going, if it's still easing there.
  target(i) {
    return this.moving.get(i) || [this.x[i], this.y[i]]
  }

  // The margin between a tray's edge and the middles of its outermost pieces.
  get trayPad() {
    return this.radius + this.geo.S * 0.25
  }

  // Fits a tray around its pieces, with a margin. An empty tray keeps
  // its top left corner and shrinks to the size of a new one.
  fitTray(t) {
    const S = this.geo.S
    if (!t.pieces.length) {
      t.w = S * TRAY_W
      t.h = S * TRAY_H
      return
    }
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const i of t.pieces) {
      const [x, y] = this.target(i)
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
    const pad = this.trayPad
    t.x = x0 - pad
    t.y = y0 - pad
    t.w = x1 - x0 + pad * 2
    t.h = y1 - y0 + pad * 2
  }

  // After this player dropped pieces (ids) with the pointer at (wx, wy): everything carried goes in
  // the tray given (the one it was carried with), or else the tray under the pointer, and comes out
  // of its tray when let go of anywhere else. Every tray that gained or lost pieces, or had them
  // moved, fits itself around them again.
  placeInTrays(ids, wx, wy, into = null) {
    if (!this.trays.length) return
    for (let k = this.trays.length - 1; k >= 0 && !into; k--) {
      const t = this.trays[k]
      if (wx >= t.x && wx <= t.x + t.w && wy >= t.y && wy <= t.y + t.h) into = t
    }
    const moved = this.withGroups(ids)
    const touched = new Set(into ? [into] : [])
    for (const t of this.trays) {
      if (t === into || !t.pieces.some((i) => moved.has(i))) continue
      t.pieces = t.pieces.filter((i) => !moved.has(i))
      touched.add(t)
    }
    if (into) into.pieces = [...new Set([...into.pieces, ...moved])]
    this.refitTrays(touched)
  }

  // After pieces were turned or sorted: the trays they're in fit themselves around them again.
  fitTraysOf(ids) {
    const set = ids instanceof Set ? ids : new Set(ids)
    this.refitTrays(this.trays.filter((t) => t.pieces.some((i) => set.has(i))))
  }

  refitTrays(trays) {
    for (const t of trays) {
      this.fitTray(t)
      this.onTray?.(t, false)
    }
    if (trays.size || trays.length) this.invalidate()
  }

  // A press on a tray: moves it, carrying the pieces in it along. The pieces are only
  // picked up once the pointer moves, so a click just selects the tray.
  startTrayDrag(th, pointer, sx, sy, wx, wy) {
    const t = th.tray
    if (this.guard && !this.guard()) return
    if (this.selCount) this.setSelection(new Set())
    this.selectRef(null)
    this.selectTray(t.id)
    this.trays = this.trays.filter((x) => x !== t).concat(t)
    this.carry = {
      pointer,
      wx,
      wy,
      sx0: sx,
      sy0: sy,
      moved: false,
      note: null,
      refs: [],
      notes: [],
      trays: [{ id: t.id, x: t.x, y: t.y }],
      lift: { ids: this.trayPieces(t), wx, wy, sx, sy },
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

    if (!this.spriteWorker && (this.built < this.n || this.backQueue.length)) {
      const had = this.built
      this.buildSome(now + 12)
      if (this.built !== had) this.sceneVer++
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
        this.panSince ||= now
        const boost = 1 + (PAN_BOOST - 1) * Math.min(1, (now - this.panSince) / PAN_RAMP) ** 2
        const f = (PAN_SPEED * boost * dt) / 1000 / Math.hypot(vx, vy) / this.cam.z
        this.cam.x += vx * f
        this.cam.y += vy * f
        this.clampCam()
        if (this.drag) {
          this.updatePivot()
          this.sendLive()
        }
      } else this.panSince = 0
      again = true
    } else this.panSince = 0

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
        if (!l.target) {
          this.lift = null
          this.sceneVer++
        }
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
      const f = ease(dt, 45)
      // A module's pieces share one turn; ease each turn once.
      const eased = new Set()
      for (const [i, t] of this.turns) {
        if (!eased.has(t)) {
          eased.add(t)
          t.a -= t.a * f
        }
        if (Math.abs(t.a) < 0.001) this.turns.delete(i)
      }
      again = true
    }

    if (this.flips.size) {
      for (const [i, t0] of this.flips) if (now - t0 >= FLIP_MS) this.flips.delete(i)
      again = true
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

    if (this.pops.length) again = true

    this.updateActive(now)
    this.draw(now)
    if (again) this.invalidate(false)
  }

  // Pieces in motion (easing into place, turning, flipping or held by another player) are left out
  // of the scene and drawn on the board every frame instead, so the scene only has to be redrawn
  // when a piece starts or stops moving, not on every frame of the movement.
  updateActive(now) {
    const prev = this.active
    const next = new Set()
    for (const i of this.moving.keys()) next.add(i)
    for (const i of this.turns.keys()) next.add(i)
    for (const i of this.flips.keys()) next.add(i)
    let until = Infinity
    for (const [i, t] of this.held) {
      if (t <= now) this.held.delete(i)
      else {
        next.add(i)
        until = Math.min(until, t)
      }
    }
    // A player who stops sending lets go after a while; their pieces then return to the scene.
    clearTimeout(this.heldTimer)
    if (until < Infinity) this.heldTimer = setTimeout(() => this.invalidate(false), until - now + 20)
    let same = next.size === prev.size
    if (same) {
      for (const i of next) {
        if (!prev.has(i)) {
          same = false
          break
        }
      }
    }
    if (!same) {
      this.active = next
      this.sceneVer++
    }
  }

  draw(now) {
    const { ctx, cam, vw, vh } = this
    const mv = this.mv
    if (cam.x !== mv.x || cam.y !== mv.y || cam.z !== mv.z || vw !== mv.w || vh !== mv.h || this.viewsVer !== this.viewFn) {
      // The stacked layers are scaled while the zoom changes and redrawn once it rests.
      if (cam.z !== mv.z) {
        this.zoomedAt = now
        clearTimeout(this.zoomTimer)
        this.zoomTimer = setTimeout(() => this.invalidate(false), ZOOM_SETTLE + 20)
      }
      mv.x = cam.x
      mv.y = cam.y
      mv.z = cam.z
      mv.w = vw
      mv.h = vh
      this.viewFn = this.viewsVer
      for (const fn of this.views) fn(cam, vw, vh)
    }
    this.frameNo++

    this.syncLayer(this.sceneL, this.sceneVer, (c, v) => this.drawScene(c, v))
    this.updateSpun()

    // The selection outline goes under pieces being carried, and over pieces still landing after a
    // drop so they get it right away. It is redrawn every frame only while selected pieces move.
    // Modules turning as one picture bring their own outline.
    if (this.sel.size) {
      let moving = false
      for (const i of this.active) {
        if (this.sel.has(i) && !this.turns.get(i)?.spun) {
          moving = true
          break
        }
      }
      const lifted = this.drag && this.lift?.set
      const key = `${this.sceneVer}:${this.selVer}:${this.spunVer}:${lifted ? 1 : 0}:${moving ? this.frameNo : 0}`
      const ids = () => [...this.sel].filter((i) => !lifted?.has(i) && !this.turns.get(i)?.spun)
      this.syncLayer(this.selL, key, (c, v) => this.drawOutline(c, ids(), this.colors.sel, v), true)
      const under = !!this.drag
      if (under !== this.selUnder) {
        this.selUnder = under
        if (under) this.canvas.before(this.selL.el)
        else this.canvas.after(this.selL.el)
      }
    } else this.hideLayer(this.selL)

    if (this.dirty) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      this.dirty = false
    }
    if (this.active.size) this.drawActive(ctx, mv)
    this.drawHighlight(ctx, mv)
    if (this.lift) this.drawLift(mv)
    this.drawChrome()
  }

  // The world rectangle a view shows, grown by e on every side, into this.cull.
  cullRect(v, e) {
    const c = (this.cull ??= {})
    const hw = v.w / 2 / v.z + e
    const hh = v.h / 2 / v.z + e
    c.x0 = v.x - hw
    c.y0 = v.y - hh
    c.x1 = v.x + hw
    c.y1 = v.y + hh
    return c
  }

  // Everything but the pieces that are lifted or moving: the table, its dots, reference images and
  // the pieces lying still. Drawn onto the scene layer for view v.
  drawScene(ctx, v) {
    const { dpr } = this
    const W = ctx.canvas.width
    const H = ctx.canvas.height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = this.colors.bg
    ctx.fillRect(0, 0, W, H)
    this.drawDots(ctx, v)

    // Trays, then reference images, lie under the pieces.
    const z = v.z * dpr
    const { x0: wx0, y0: wy0, x1: wx1, y1: wy1 } = this.cullRect(v, 0)
    this.drawTrays(ctx, v, wx0, wy0, wx1, wy1)
    for (const ref of this.refs) {
      const [w, h] = this.refSize(ref)
      if (ref.x + w / 2 < wx0 || ref.x - w / 2 > wx1 || ref.y + h / 2 < wy0 || ref.y - h / 2 > wy1) continue
      ctx.setTransform(z, 0, 0, z, ((ref.x - v.x) * v.z + v.w / 2) * dpr, ((ref.y - v.y) * v.z + v.h / 2) * dpr)
      ctx.drawImage(this.refImg, -w / 2, -h / 2, w, h)
      const on = this.selRefs.has(ref.id)
      ctx.lineWidth = ((on ? 3 : 1) * dpr) / z
      ctx.strokeStyle = on ? this.colors.sel : this.colors.dot
      ctx.strokeRect(-w / 2, -h / 2, w, h)
    }

    const cr = this.cullRect(v, this.radius)
    const lifted = this.lift?.set
    const active = this.active
    for (const i of this.order) {
      if (lifted?.has(i) || active.has(i)) continue
      this.poseInto(i)
      const x = this.qx
      const y = this.qy
      if (x < cr.x0 || x > cr.x1 || y < cr.y0 || y > cr.y1) continue
      this.drawPiece(ctx, i, x, y, this.qa, 1, v)
    }
  }

  // Each tray: a tinted, rounded box, outlined in the selection colour while selected.
  drawTrays(ctx, v, wx0, wy0, wx1, wy1) {
    if (!this.trays.length) return
    const { dpr } = this
    const z = v.z * dpr
    const r = Math.min(this.geo.S * 0.25, 10 / v.z)
    for (const t of this.trays) {
      if (t.x + t.w < wx0 || t.x > wx1 || t.y + t.h < wy0 || t.y > wy1) continue
      const color = TRAY_COLORS[t.color] || TRAY_COLORS.gray
      const on = t.id === this.traySel
      ctx.setTransform(z, 0, 0, z, ((t.x - v.x) * v.z + v.w / 2) * dpr, ((t.y - v.y) * v.z + v.h / 2) * dpr)
      ctx.fillStyle = color
      ctx.globalAlpha = 0.16
      ctx.beginPath()
      ctx.roundRect(0, 0, t.w, t.h, r)
      ctx.fill()
      ctx.globalAlpha = on ? 1 : 0.7
      ctx.lineWidth = ((on ? 2.5 : 1.25) * dpr) / z
      ctx.strokeStyle = on ? this.colors.sel : color
      ctx.beginPath()
      ctx.roundRect(0, 0, t.w, t.h, r)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  // The dot grid, filled in one go from a small tile holding a single dot. The tile is a whole
  // number of pixels, and the pattern is scaled by the little that is left over so the dots stay on
  // the world grid.
  drawDots(ctx, v) {
    const { dpr } = this
    let sp = this.geo.S
    while (sp * v.z < 22) sp *= 2
    while (sp * v.z > 44) sp /= 2
    const step = sp * v.z * dpr
    const N = Math.max(1, Math.round(step))
    const k = step / N
    const ds = Math.max(1, 1.25 * dpr) / k
    const key = `${N}:${ds}:${this.colors.dot}`
    if (key !== this.dotKey) {
      const tile = makeCanvas(N, N)
      const tc = tile.getContext('2d')
      tc.fillStyle = this.colors.dot
      tc.fillRect(N / 2 - ds / 2, N / 2 - ds / 2, ds, ds)
      this.dotPattern = ctx.createPattern(tile, 'repeat')
      this.dotKey = key
    }
    // Where world (0, 0), a grid point, lands, less half a tile, wrapped to within one step.
    const wrap = (a) => ((a % step) + step) % step
    const ox = wrap((-v.x * v.z + v.w / 2) * dpr - (k * N) / 2)
    const oy = wrap((-v.y * v.z + v.h / 2) * dpr - (k * N) / 2)
    this.dotPattern.setTransform(new DOMMatrix([k, 0, 0, k, ox, oy]))
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = this.dotPattern
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  }

  // Which turns can be drawn as one picture: a big module turning on the table, all of it still in
  // that turn and none of it also moving, flipping or held. Marks them spun, and bumps spunVer when
  // that changes, so the selection outline is redrawn without them or with them again.
  updateSpun() {
    const now = new Set()
    if (this.turns.size) {
      const seen = new Set()
      for (const t of this.turns.values()) {
        if (seen.has(t)) continue
        seen.add(t)
        t.spun = !!t.ids && t.ids.every((i) => this.turns.get(i) === t && !this.moving.has(i) && !this.flips.has(i) && !this.held.has(i))
        if (t.spun) now.add(t)
      }
    }
    const was = (this.spun ??= new Set())
    if (now.size !== was.size || [...now].some((t) => !was.has(t))) this.spunVer = (this.spunVer || 0) + 1
    this.spun = now
  }

  // A module turning on the table drawn once, as it lies after the turn, into a picture the size of
  // its box, with its selection outline in another if it is selected. Kept for the whole turn.
  turnSprite(t) {
    if (t.sprite) return t.sprite
    const R = this.radius
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const i of t.ids) {
      x0 = Math.min(x0, this.x[i] - R)
      y0 = Math.min(y0, this.y[i] - R)
      x1 = Math.max(x1, this.x[i] + R)
      y1 = Math.max(y1, this.y[i] + R)
    }
    const res = Math.min(this.cam.z * this.dpr * 1.05, this.spriteScale, LIFT_MAX / Math.max(x1 - x0, y1 - y0))
    const W = Math.max(1, Math.ceil((x1 - x0) * res))
    const H = Math.max(1, Math.ceil((y1 - y0) * res))
    const c = makeCanvas(W, H)
    const ctx = c.getContext('2d')
    const set = new Set(t.ids)
    const w = this.spriteW
    const h = this.spriteH
    for (const i of this.order) {
      if (!set.has(i)) continue
      const lv = this.face(i, true)
      if (!lv) continue
      const sx = this.fsx
      const a = this.r[i] * Q
      const co = Math.cos(a) * res
      const sn = Math.sin(a) * res
      ctx.setTransform(co * sx, sn * sx, -sn, co, (this.x[i] - x0) * res, (this.y[i] - y0) * res)
      ctx.drawImage(this.pick(lv, res), -w / 2, -h / 2, w, h)
    }
    let line = null
    if (this.sel.has(t.ids[0])) {
      // The outline as it will be after the turn: drawn with no turns in progress.
      line = makeCanvas(W, H)
      const turns = this.turns
      this.turns = new Map()
      const v = { x: x0 + W / res / 2, y: y0 + H / res / 2, z: res / this.dpr, w: W / this.dpr, h: H / this.dpr }
      if (!this.drawOutline(line.getContext('2d'), set, this.colors.sel, v)) line = null
      this.turns = turns
    }
    return (t.sprite = { c, line, x0, y0, res })
  }

  // A spun module (see updateSpun) at its turn so far: its picture turned around the turn's centre.
  drawTurn(ctx, t, v) {
    const sp = this.turnSprite(t)
    const { dpr } = this
    const z = (v.z * dpr) / sp.res
    const co = Math.cos(t.a) * z
    const sn = Math.sin(t.a) * z
    ctx.setTransform(co, sn, -sn, co, ((t.cx - v.x) * v.z + v.w / 2) * dpr, ((t.cy - v.y) * v.z + v.h / 2) * dpr)
    const x = (sp.x0 - t.cx) * sp.res
    const y = (sp.y0 - t.cy) * sp.res
    ctx.drawImage(sp.c, x, y)
    if (sp.line) ctx.drawImage(sp.line, x, y)
  }

  // The pieces left out of the scene because they move, in table order. Spun modules go first, each
  // as one picture.
  drawActive(ctx, v) {
    for (const t of this.spun) {
      this.drawTurn(ctx, t, v)
      this.dirty = true
    }
    const cr = this.cullRect(v, this.radius * 1.2)
    const lifted = this.lift?.set
    const active = this.active
    for (const i of this.order) {
      if (!active.has(i) || lifted?.has(i) || this.turns.get(i)?.spun) continue
      this.poseInto(i)
      const x = this.qx
      const y = this.qy
      if (x < cr.x0 || x > cr.x1 || y < cr.y0 || y > cr.y1) continue
      this.drawPiece(ctx, i, x, y, this.qa, 1, v)
      this.dirty = true
    }
  }

  // The hover outline of one piece, drawn into a canvas just big enough for the part of it on the
  // board (zoomed far in, a piece can be many times the size of the screen) and copied onto the
  // board at a whole pixel. Only redrawn when the piece, its pose or the view changes.
  drawHighlight(ctx, mv) {
    const hl = this.hl
    if (!hl || this.drag) return
    const { dpr } = this
    const i = hl.ids[0]
    this.poseInto(i)
    // Big enough for a long piece reaching out from its first cell.
    const r = (this.radius + (hl.ids.length - 1) * Math.max(this.geo.w, this.geo.h)) * mv.z + 8
    const X = ((this.qx - mv.x) * mv.z + mv.w / 2) * dpr
    const Y = ((this.qy - mv.y) * mv.z + mv.h / 2) * dpr
    const x0 = Math.max(0, Math.floor(X - r * dpr))
    const y0 = Math.max(0, Math.floor(Y - r * dpr))
    const x1 = Math.min(this.canvas.width, Math.ceil(X + r * dpr) + 2)
    const y1 = Math.min(this.canvas.height, Math.ceil(Y + r * dpr) + 2)
    if (x1 <= x0 || y1 <= y0) return
    const bw = x1 - x0
    const bh = y1 - y0
    const c = this.hlLayer
    const color = this.colors.line || '#000'
    const key = `${hl.key}:${this.qx}:${this.qy}:${this.qa}:${mv.x}:${mv.y}:${mv.z}:${dpr}:${x0}:${y0}:${bw}:${bh}:${color}`
    if (key !== this.hlKey) {
      // Grown as needed, and shrunk again when far too big.
      if (c.width < bw || c.height < bh || c.width * c.height > 4 * bw * bh) {
        c.width = bw
        c.height = bh
      }
      const w = bw / dpr
      const h = bh / dpr
      const v = { x: mv.x + (x0 / dpr + w / 2 - mv.w / 2) / mv.z, y: mv.y + (y0 / dpr + h / 2 - mv.h / 2) / mv.z, z: mv.z, w, h }
      this.hlShown = this.drawOutline(this.hlCtx, hl.ids, color, v)
      this.hlKey = key
    }
    if (!this.hlShown) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(c, 0, 0, bw, bh, x0, y0, bw, bh)
    this.dirty = true
  }

  // Draws the lifted pieces with a drop shadow onto the board. Carried as one sprite, they are one
  // drawImage and their blurred shadow is kept (see shadowFor()). Otherwise (mid spin, or landing
  // after a drop that didn't move everything alike) the pieces are drawn one by one into a layer
  // and the shadow is blurred from that at a third of the resolution, only within their box.
  drawLift(mv) {
    const { ctx, dpr, cam } = this
    const { vw, vh } = this
    const l = this.lift
    // Lifted pieces grow a little, spreading out from the pointer as they do, or from (cx, cy) off
    // it when set (a tray's middle, in the carried pieces' own frame, before any turn).
    const s = 1 + 0.045 * l.value
    const d = this.drag && this.drag.set === l.set ? this.drag : null
    const a = d ? d.angle : l.angle
    // Growing around (cx, cy) moves the pointer's own spot by (1 - s) of the way to it, turned with
    // the pieces: (px, py) is where the carried pieces' origin is drawn, in world units.
    const gx = (l.cx || 0) * (1 - s)
    const gy = (l.cy || 0) * (1 - s)
    const px = l.px + gx * Math.cos(a) - gy * Math.sin(a)
    const py = l.py + gx * Math.sin(a) + gy * Math.cos(a)
    this.dirty = true

    // Mid spin the sprite still does when everything carried turns together around one centre (one
    // module, or all of it at once): it's the sprite turned by what's left of the spin.
    const turn = d?.spinning ? this.rigidSpin(d) : null
    if (l.sprite && (!d?.spinning || turn)) {
      const sp = l.sprite
      const z = (cam.z * dpr * s) / sp.res
      const co = Math.cos(a) * z
      const sn = Math.sin(a) * z
      const X = ((px - cam.x) * cam.z + vw / 2) * dpr
      const Y = ((py - cam.y) * cam.z + vh / 2) * dpr
      // Turns the sprite (in its own pixels, k of them per sprite pixel) around the spin's centre.
      const spun = (k) => {
        if (!turn?.a) return
        ctx.translate((turn.cx * sp.res) / k, (turn.cy * sp.res) / k)
        ctx.rotate(turn.a)
        ctx.translate((-turn.cx * sp.res) / k, (-turn.cy * sp.res) / k)
      }
      const sh = this.shadowFor(sp, l.value, z)
      const q = sh.q
      ctx.setTransform(co * q, sn * q, -sn * q, co * q, X + (1 + 7 * l.value) * dpr, Y + (2 + 16 * l.value) * dpr)
      spun(q)
      ctx.drawImage(sh.c, (sp.x0 * sp.res) / q - sh.pad, (sp.y0 * sp.res) / q - sh.pad)
      ctx.setTransform(co, sn, -sn, co, X, Y)
      spun(1)
      ctx.drawImage(sp.c, sp.x0 * sp.res, sp.y0 * sp.res)
      return
    }

    const { x0: wx0, y0: wy0, x1: wx1, y1: wy1 } = this.cullRect(mv, 0)
    const lc = this.lctx
    if (this.layer.width !== this.canvas.width || this.layer.height !== this.canvas.height) {
      this.layer.width = this.canvas.width
      this.layer.height = this.canvas.height
      this.liftBox = null
    }
    const W = this.layer.width
    const H = this.layer.height
    lc.setTransform(1, 0, 0, 1, 0, 0)
    const pb = this.liftBox
    if (pb) lc.clearRect(pb[0], pb[1], pb[2] - pb[0], pb[3] - pb[1])
    else lc.clearRect(0, 0, W, H)

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

    const R = this.radius
    const e = R * s * cam.z * dpr
    if (d?.spinning) {
      // Mid spin every piece turns on its own, so draw them one by one instead of the sprite.
      const ca = Math.cos(d.angle)
      const sa = Math.sin(d.angle)
      for (let j = 0; j < d.ids.length; j++) {
        const a = d.sa[j]
        const dx = d.ox[j] - d.cx[j]
        const dy = d.oy[j] - d.cy[j]
        const ox = d.cx[j] + dx * Math.cos(a) - dy * Math.sin(a) + d.tx[j]
        const oy = d.cy[j] + dx * Math.sin(a) + dy * Math.cos(a) + d.ty[j]
        const x = px + (ox * ca - oy * sa) * s
        const y = py + (ox * sa + oy * ca) * s
        if (x + R * s < wx0 || x - R * s > wx1 || y + R * s < wy0 || y - R * s > wy1) continue
        this.drawPiece(lc, d.ids[j], x, y, d.r0[j] * Q + a + d.angle, s, mv)
        const X = ((x - cam.x) * cam.z + vw / 2) * dpr
        const Y = ((y - cam.y) * cam.z + vh / 2) * dpr
        grow(X - e, Y - e)
        grow(X + e, Y + e)
      }
    } else {
      for (const i of l.ids) {
        const x = px + (this.x[i] - l.px) * s
        const y = py + (this.y[i] - l.py) * s
        if (x + R * s < wx0 || x - R * s > wx1 || y + R * s < wy0 || y - R * s > wy1) continue
        this.drawPiece(lc, i, x, y, this.r[i] * Q, s, mv)
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

  // Mid spin: the centre every carried piece turns around and the turn still left, if they all share
  // them and nothing is being gathered, so the lift sprite can be drawn turned. Null otherwise.
  rigidSpin(d) {
    const { cx, cy, sa, tx, ty } = d
    for (let j = 0; j < sa.length; j++) {
      if (cx[j] !== cx[0] || cy[j] !== cy[0] || sa[j] !== sa[0] || tx[j] || ty[j]) return null
    }
    return { cx: cx[0], cy: cy[0], a: sa[0] }
  }

  // The lift sprite's blurred silhouette at a third of its resolution, for a shadow drawn under it
  // with the same transform. z is how many board pixels a sprite pixel covers now. Kept while the
  // lift has settled and the zoom stays close, so a drag doesn't blur anything per frame.
  shadowFor(sp, value, z) {
    const o = this.liftShadow
    const color = this.colors.shadow
    if (o && o.sp === sp && o.color === color && Math.abs(o.value - value) < 0.01 && o.z / z < 1.15 && z / o.z < 1.15) return o
    const q = 3
    const blur = ((4 + 26 * value) * this.dpr) / (z * q)
    const pad = Math.ceil(blur * 1.5) + 2
    const c = o?.c || makeCanvas(0, 0)
    const w = Math.ceil(sp.c.width / q)
    const h = Math.ceil(sp.c.height / q)
    c.width = w + 2 * pad
    c.height = h + 2 * pad
    const x = c.getContext('2d')
    // Draw the silhouette off-canvas and let only its shadow land.
    const off = c.width + 20
    x.shadowColor = color
    x.shadowBlur = blur
    x.shadowOffsetX = off
    x.drawImage(sp.c, pad - off, pad, sp.c.width / q, sp.c.height / q)
    return (this.liftShadow = { c, sp, color, value, z, q, pad })
  }

  // Screen-space overlays: the selection box and the selected reference image's handles.
  drawChrome() {
    const { ctx, dpr } = this
    const sel = this.refSel && this.refs.find((r) => r.id === this.refSel)
    if (sel) {
      this.dirty = true
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
        ctx.beginPath()
        ctx.roundRect(hx - HANDLE / 2 - 1, hy - HANDLE / 2 - 1, HANDLE + 2, HANDLE + 2, 3)
        ctx.fill()
        ctx.stroke()
      }
    }
    this.drawPops()
    this.drawCursors()
    const m = this.marquee
    if (m && Math.abs(m.sx - m.sx0) + Math.abs(m.sy - m.sy0) > 2) {
      const x = Math.min(m.sx0, m.sx)
      const y = Math.min(m.sy0, m.sy)
      const w = Math.abs(m.sx - m.sx0)
      const h = Math.abs(m.sy - m.sy0)
      this.dirty = true
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
  // A ring and a few sparks growing out of each new seam, fading as they go. White with a soft
  // shadow, so they show on any picture.
  drawPops() {
    const now = performance.now()
    this.pops = this.pops.filter((p) => now - p.t0 < POP_MS)
    if (!this.pops.length) return
    const { ctx, dpr, cam, vw, vh } = this
    this.dirty = true
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
    ctx.shadowBlur = 4
    ctx.strokeStyle = '#fff'
    ctx.fillStyle = '#fff'
    const size = Math.max(8, Math.min(44, this.geo.S * cam.z * 0.4))
    for (const p of this.pops) {
      const t = (now - p.t0) / POP_MS
      if (t < 0) continue
      const e = 1 - (1 - t) ** 3
      const sx = (p.x - cam.x) * cam.z + vw / 2
      const sy = (p.y - cam.y) * cam.z + vh / 2
      ctx.globalAlpha = (1 - t) ** 1.5
      ctx.lineWidth = 2.5 * (1 - t) + 0.5
      ctx.beginPath()
      ctx.arc(sx, sy, size * (0.25 + 0.75 * e), 0, Math.PI * 2)
      ctx.stroke()
      const d = size * (0.35 + 1.05 * e)
      const r = 2.2 * (1 - t) + 0.4
      for (let k = 0; k < 6; k++) {
        const a = p.a + (k * Math.PI) / 3
        ctx.beginPath()
        ctx.arc(sx + Math.cos(a) * d, sy + Math.sin(a) * d, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
    ctx.shadowColor = 'transparent'
  }

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
  // outline, then punch the piece shapes back out. Only pieces on the edge of the union are
  // stroked, and only those and their neighbours punched, so a big module costs about its rim.
  // Clears c's canvas and draws the outline there for view v. Returns whether anything was in view.
  drawOutline(c, ids, color, v) {
    const { dpr } = this
    const z = v.z * dpr
    const { cols, rows } = this.room
    const set = ids instanceof Set ? ids : new Set(ids)
    // A grid neighbour in the same group and the same set lies exactly against the piece.
    const inner = (i) => {
      const col = i % cols
      const row = (i / cols) | 0
      const g = this.g[i]
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          const cc = col + dc
          const rr = row + dr
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) return false
          const j = rr * cols + cc
          if (this.g[j] !== g || !set.has(j)) return false
        }
      }
      return true
    }
    const cr = this.cullRect(v, this.radius + (5 * dpr) / z)
    const edge = []
    const rim = new Set()
    for (const i of set) {
      this.poseInto(i)
      if (this.qx < cr.x0 || this.qx > cr.x1 || this.qy < cr.y0 || this.qy > cr.y1) continue
      if (inner(i)) continue
      edge.push(i)
      rim.add(i)
    }
    // Strokes reach into the neighbours of edge pieces, so those get punched too (after the edge pieces).
    const punch = edge.slice()
    for (const i of edge) {
      const col = i % cols
      const row = (i / cols) | 0
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const cc = col + dc
          const rr = row + dr
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue
          const j = rr * cols + cc
          if (!rim.has(j) && set.has(j) && this.g[j] === this.g[i]) {
            rim.add(j)
            punch.push(j)
          }
        }
      }
    }
    const place = (i) => {
      this.poseInto(i)
      const co = Math.cos(this.qa) * z
      const sn = Math.sin(this.qa) * z
      const sx = this.f[i] ? -1 : 1
      c.setTransform(co * sx, sn * sx, -sn, co, ((this.qx - v.x) * v.z + v.w / 2) * dpr, ((this.qy - v.y) * v.z + v.h / 2) * dpr)
    }
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, c.canvas.width, c.canvas.height)
    if (!edge.length) return false
    if (punch.length > OUTLINE_PATHS) this.outlineMasks(c, edge, punch, color, v)
    else {
      c.lineJoin = 'round'
      c.strokeStyle = color
      c.lineWidth = (5 * dpr) / z
      for (const i of edge) {
        place(i)
        c.stroke(this.paths[i])
      }
      c.globalCompositeOperation = 'destination-out'
      c.lineWidth = (1.5 * dpr) / z
      for (const i of punch) {
        place(i)
        c.fill(this.paths[i])
        c.stroke(this.paths[i])
      }
      c.globalCompositeOperation = 'source-over'
    }
    return true
  }

  // The same outline as the stroked one, for many pieces at once: draws the edge pieces'
  // silhouettes (one image each, as cheap as drawing the pieces), grows that by the outline width
  // by stamping it around a circle, colours it, and cuts the silhouettes of the edge pieces and
  // their neighbours back out. Past the silhouettes the cost doesn't depend on how many pieces there are.
  // The silhouettes go in a canvas only as big as the edge pieces' box.
  outlineMasks(c, edge, punch, color, v) {
    const { dpr } = this
    const z = v.z * dpr
    const W = c.canvas.width
    const H = c.canvas.height
    const e = this.radius * z
    const r = 2.5 * dpr
    const q = 0.75 * dpr
    const pad = Math.ceil(r) + 2
    let bx0 = Infinity
    let by0 = Infinity
    let bx1 = -Infinity
    let by1 = -Infinity
    for (const i of edge) {
      this.poseInto(i)
      const X = ((this.qx - v.x) * v.z + v.w / 2) * dpr
      const Y = ((this.qy - v.y) * v.z + v.h / 2) * dpr
      bx0 = Math.min(bx0, X - e)
      by0 = Math.min(by0, Y - e)
      bx1 = Math.max(bx1, X + e)
      by1 = Math.max(by1, Y + e)
    }
    const x0 = Math.max(0, Math.floor(bx0) - pad)
    const y0 = Math.max(0, Math.floor(by0) - pad)
    const x1 = Math.min(W, Math.ceil(bx1) + pad)
    const y1 = Math.min(H, Math.ceil(by1) + pad)
    if (x1 <= x0 || y1 <= y0) return
    const bw = x1 - x0
    const bh = y1 - y0
    const M = this.maskLayer
    const mc = this.maskCtx
    // Grown as needed, and shrunk again when far too big, so it doesn't hold a whole screen for good.
    if (M.width < bw || M.height < bh || M.width * M.height > 4 * bw * bh) {
      M.width = bw
      M.height = bh
    }
    mc.setTransform(1, 0, 0, 1, 0, 0)
    mc.clearRect(0, 0, bw, bh)
    const sw = this.spriteW
    const sh = this.spriteH
    const silhouette = (i) => {
      this.poseInto(i)
      const X = ((this.qx - v.x) * v.z + v.w / 2) * dpr - x0
      const Y = ((this.qy - v.y) * v.z + v.h / 2) * dpr - y0
      const mk = (this.masks[i] ??= this.makeMask(i))
      const co = Math.cos(this.qa) * z
      const sn = Math.sin(this.qa) * z
      const fx = this.f[i] ? -1 : 1
      mc.setTransform(co * fx, sn * fx, -sn, co, X, Y)
      mc.drawImage(mk, -sw / 2, -sh / 2, sw, sh)
    }
    for (const i of edge) silhouette(i)
    c.setTransform(1, 0, 0, 1, 0, 0)
    const stamp = (dx, dy) => c.drawImage(M, 0, 0, bw, bh, x0 + dx, y0 + dy, bw, bh)
    for (let k = 0; k < 12; k++) stamp(Math.cos((k * Math.PI) / 6) * r, Math.sin((k * Math.PI) / 6) * r)
    c.globalCompositeOperation = 'source-in'
    c.fillStyle = color
    c.fillRect(x0 - pad, y0 - pad, bw + 2 * pad, bh + 2 * pad)
    // Punch holds the edge pieces first, so this adds just their neighbours.
    for (let k = edge.length; k < punch.length; k++) silhouette(punch[k])
    // Cutting out a slightly grown silhouette also clears the faint seams between pieces.
    c.globalCompositeOperation = 'destination-out'
    stamp(0, 0)
    for (let k = 0; k < 8; k++) stamp(Math.cos((k * Math.PI) / 4) * q, Math.sin((k * Math.PI) / 4) * q)
    c.globalCompositeOperation = 'source-over'
  }

  // Draws piece i at (x, y, angle a), scaled by s, into ctx for view v, from the smallest sprite
  // level that is still sharp at this zoom.
  drawPiece(ctx, i, x, y, a, s, v) {
    const lv = this.face(i)
    if (!lv) return
    const { dpr } = this
    const sx = this.fsx
    const z = v.z * dpr * s * this.flift
    const c = Math.cos(a) * z
    const sn = Math.sin(a) * z
    ctx.setTransform(c * sx, sn * sx, -sn, c, ((x - v.x) * v.z + v.w / 2) * dpr, ((y - v.y) * v.z + v.h / 2) * dpr)
    const w = this.spriteW
    const h = this.spriteH
    ctx.drawImage(this.pick(lv, z), -w / 2, -h / 2, w, h)
  }
}
