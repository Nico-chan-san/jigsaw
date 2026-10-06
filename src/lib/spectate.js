// Spectator mode: the table as a wall of screens, one per player, each following that player's
// cursor. When a player connects pieces, their screen grows to fill the window, replays the move in
// slow motion and celebrates, then the screens slide back. The engine draws every screen with its
// own GPU frame (see Engine.drawGpu()) and copies it into the screen's canvas.
import { POP_MS } from './engine.js'

const PAD = { t: 68, r: 20, b: 20, l: 20 }
const GAP = 20
// Every screen has this shape (width over height).
const ASPECT = 1.5
// A screen shows about this many pieces across.
const ZOOM_PIECES = 20
// While one screen is in focus, the others wait in a row at the bottom.
const THUMB_H = 84
// The focus: the screen grows, then the move replays (if it was seen), then the celebration.
const FOCUS_IN = 650
const REPLAY_SLOW = 0.65
const CELEBRATE_MS = 2600
const COOL_MS = 1500
// The focused screen shows about this many pieces across.
const FOCUS_PIECES = 16
// A replay shows at most this much of the lead up to the snap (ms).
const REPLAY_MAX = 2600
const CONFETTI = ['#ff4d4f', '#ffb020', '#2fbf71', '#2f9bff', '#a15cff', '#ff5fb1']
const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)')

const ease = (dt, ms) => 1 - Math.exp(-dt / ms)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

// Where n screens go in a w by h area: as many rows as make them biggest, the first rows getting
// the extra ones, every row centred. Three players: two on top, one below in the middle.
export function gridRects(n, w, h) {
  if (!n) return []
  let best = null
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows)
    const cw = (w - (cols - 1) * GAP) / cols
    const ch = (h - (rows - 1) * GAP) / rows
    const tw = Math.min(cw, ch * ASPECT)
    if (tw > 0 && (!best || tw > best.tw + 0.5)) best = { rows, tw }
  }
  const { rows } = best || { rows: n }
  const tw = best ? best.tw : 40
  const th = tw / ASPECT
  const top = (h - (rows * th + (rows - 1) * GAP)) / 2
  const base = Math.floor(n / rows)
  const extra = n % rows
  const out = []
  for (let r = 0; r < rows; r++) {
    const count = base + (r < extra ? 1 : 0)
    const left = (w - (count * tw + (count - 1) * GAP)) / 2
    for (let c = 0; c < count; c++) out.push({ x: left + c * (tw + GAP), y: top + r * (th + GAP), w: tw, h: th })
  }
  return out
}

export class Spectator {
  constructor(engine, host) {
    this.e = engine
    this.host = host
    // client -> screen. '*' is the overview shown while nobody is playing.
    this.tiles = new Map()
    this.seq = 0
    this.prev = 0
    this.focus = null
    this.cool = 0
    this.bursts = []
    this.confetti = []
    engine.setSpectator(this)
  }

  destroy() {
    this.e.rlift.delete('replay')
    this.e.setSpectator(null)
    for (const t of this.tiles.values()) t.el.remove()
    this.tiles.clear()
  }

  // ---- screens -------------------------------------------------------------

  makeTile(client) {
    const el = document.createElement('div')
    el.className = 'spec-tile'
    el.style.opacity = '0'
    const canvas = document.createElement('canvas')
    const vignette = document.createElement('div')
    vignette.className = 'spec-vignette'
    const flash = document.createElement('div')
    flash.className = 'spec-flash'
    const name = document.createElement('div')
    name.className = 'spec-name'
    const dot = document.createElement('i')
    const label = document.createElement('span')
    name.append(dot, label)
    const badge = document.createElement('div')
    badge.className = 'spec-badge'
    el.append(canvas, vignette, flash, name, badge)
    this.host.appendChild(el)
    const t = {
      client,
      el,
      canvas,
      ctx: canvas.getContext('2d'),
      flash,
      dot,
      label,
      badge,
      seq: this.seq++,
      cursor: null,
      leaving: false,
      // Where it is drawn now and where it is headed (px), how visible it is (0 to 1).
      rect: null,
      to: { x: 0, y: 0, w: 2, h: 2 },
      a: 0,
      cam: null,
      fitAt: 0,
      shown: { name: null, badge: null, dim: null, color: null },
    }
    this.tiles.set(client, t)
    return t
  }

  // One screen per player with a pointer on the table; the overview while there is none.
  sync() {
    const { cursors } = this.e
    for (const [client, cursor] of cursors) {
      const t = this.tiles.get(client) || this.makeTile(client)
      t.cursor = cursor
      t.leaving = false
    }
    const occupied = cursors.size > 0 || !!this.focus
    for (const [client, t] of this.tiles) {
      if (client === '*') t.leaving = occupied
      else if (!cursors.has(client) && this.focus?.tile !== t) t.leaving = true
    }
    if (!occupied) {
      const t = this.tiles.get('*') || this.makeTile('*')
      t.leaving = false
    }
  }

  layout() {
    const { vw, vh } = this.e
    const area = { w: vw - PAD.l - PAD.r, h: vh - PAD.t - PAD.b }
    const live = [...this.tiles.values()].filter((t) => !t.leaving).sort((a, b) => a.seq - b.seq)
    const focus = this.focus?.tile
    if (focus && live.includes(focus)) {
      const others = live.filter((t) => t !== focus)
      const strip = others.length ? THUMB_H + GAP : 0
      Object.assign(focus.to, { x: PAD.l, y: PAD.t, w: area.w, h: area.h - strip })
      const tw = Math.min(THUMB_H * ASPECT, (area.w - (others.length - 1) * GAP) / Math.max(1, others.length))
      const left = PAD.l + (area.w - (others.length * tw + (others.length - 1) * GAP)) / 2
      others.forEach((t, i) => Object.assign(t.to, { x: left + i * (tw + GAP), y: vh - PAD.b - THUMB_H, w: tw, h: THUMB_H }))
      return
    }
    gridRects(live.length, area.w, area.h).forEach((r, i) => Object.assign(live[i].to, { ...r, x: r.x + PAD.l, y: r.y + PAD.t }))
  }

  // ---- cameras -------------------------------------------------------------

  // A screen follows its player's pointer, only moving once it gets near the edge.
  follow(t, dt) {
    const e = this.e
    const { to } = t
    let tx
    let ty
    let tz = clamp(to.w / (e.geo.w * ZOOM_PIECES), e.zmin, e.zmax)
    if (t.client === '*') {
      // Nobody here: the whole table.
      if (!t.fit || performance.now() - t.fitAt > 2000) {
        t.fit = e.bbox(e.order)
        t.fitAt = performance.now()
      }
      const b = t.fit
      tx = (b.x0 + b.x1) / 2
      ty = (b.y0 + b.y1) / 2
      tz = clamp(Math.min(to.w / (b.x1 - b.x0), to.h / (b.y1 - b.y0)) * 0.85, e.zmin, e.zmax)
    } else if (t.cursor) {
      tx = t.cursor.x
      ty = t.cursor.y
    } else return
    if (!t.cam) {
      t.cam = { x: tx, y: ty, z: tz }
      return
    }
    const cam = t.cam
    const hw = (to.w / 2 / cam.z) * 0.3
    const hh = (to.h / 2 / cam.z) * 0.3
    const dx = tx - cam.x
    const dy = ty - cam.y
    const f = calm?.matches ? 1 : ease(dt, 260)
    cam.x += (dx > hw ? dx - hw : dx < -hw ? dx + hw : 0) * f
    cam.y += (dy > hh ? dy - hh : dy < -hh ? dy + hh : 0) * f
    cam.z += (tz - cam.z) * (calm?.matches ? 1 : ease(dt, 320))
  }

  // The focused screen: after the pieces during the replay, then in close on where they joined.
  focusCam(t, dt) {
    const e = this.e
    const f = this.focus
    const base = clamp(t.to.w / (e.geo.w * FOCUS_PIECES), e.zmin, e.zmax)
    let tx = f.at[0]
    let ty = f.at[1]
    let tz = base
    let ms = 380
    if (f.phase !== 'win' && f.replay) {
      const p = e.traceAt(f.replay.frames, f.u)
      tx = p.px
      ty = p.py
      tz = base
      ms = 170
    }
    if (!t.cam) t.cam = { x: tx, y: ty, z: tz }
    const k = calm?.matches ? 1 : ease(dt, ms)
    t.cam.x += (tx - t.cam.x) * k
    t.cam.y += (ty - t.cam.y) * k
    t.cam.z += (tz - t.cam.z) * (calm?.matches ? 1 : ease(dt, 420))
  }

  // ---- the focus -----------------------------------------------------------

  // Called by the engine when another player has just connected pieces. info: { client, trace,
  // at: [x, y] where, seams }.
  snapped(info) {
    const now = performance.now()
    if (this.focus || now < this.cool) return
    const t = this.tiles.get(info.client) || this.makeTile(info.client)
    t.leaving = false
    // The last stretch of the carry, if it was seen from the grab.
    let replay = null
    const frames = info.trace?.frames
    if (frames?.length >= 3) {
      const end = frames[frames.length - 1].t
      const part = frames.filter((q) => q.t >= end - REPLAY_MAX)
      const span = end - part[0].t
      if (part.length >= 3 && span >= 200) replay = { ...info.trace, frames: part, ms: clamp(span / REPLAY_SLOW, 1200, 4200) }
    }
    this.focus = {
      tile: t,
      client: info.client,
      at: info.at,
      seams: info.seams,
      replay,
      t0: now,
      phase: 'in',
      u: 0,
    }
    this.e.invalidate()
  }

  // Moves the focus along: grow, replay, celebrate, and finally back to the grid.
  stepFocus(now) {
    const f = this.focus
    if (!f) return
    const { e } = this
    const el = now - f.t0
    const replayEnd = FOCUS_IN + (f.replay ? f.replay.ms : 0)
    const phase = el < FOCUS_IN ? 'in' : f.replay && el < replayEnd ? 'replay' : el < replayEnd + CELEBRATE_MS ? 'win' : 'out'
    if (phase === 'out') {
      e.rlift.delete('replay')
      this.setBadge(f.tile, '', '')
      f.tile.el.classList.remove('focus')
      this.focus = null
      this.cool = now + COOL_MS
      this.confetti = []
      return
    }
    if (phase !== f.phase) {
      f.phase = phase
      if (phase === 'replay') {
        // Cut back in time: the carried pieces are in the air again.
        const ids = f.replay.ids
        e.rlift.set('replay', { ids, set: new Set(ids), value: 1, target: 1 })
        this.flash(f.tile)
      } else if (phase === 'win') {
        const rl = e.rlift.get('replay')
        if (rl) rl.target = 0
        this.flash(f.tile)
        this.celebrate(f, now)
      }
    }
    if (phase === 'in') f.tile.el.classList.add('focus')
    f.u = phase === 'replay' ? 1 - (1 - clamp((el - FOCUS_IN) / f.replay.ms, 0, 1)) ** 1.5 : phase === 'win' ? 1 : 0
    const name = f.tile.cursor?.name || 'Someone'
    if (phase === 'replay') this.setBadge(f.tile, 'replay', 'Instant replay')
    else if (phase === 'win') this.setBadge(f.tile, 'win', `🎉 ${name} matched ${f.seams > 1 ? 'pieces' : 'a piece'}!`)
    else this.setBadge(f.tile, '', '')
  }

  flash(t) {
    if (calm?.matches) return
    t.flash.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 480, easing: 'ease-out' })
  }

  // Bursts where the pieces joined, and confetti from there.
  celebrate(f, now) {
    const [x, y] = f.at
    for (let i = 0; i < 3; i++) this.bursts.push({ x, y, t0: now + i * 240, a: Math.random() * Math.PI })
    if (calm?.matches) return
    const colors = [f.tile.cursor?.color || CONFETTI[0], ...CONFETTI]
    for (let i = 0; i < 110; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3
      const v = 250 + Math.random() * 650
      this.confetti.push({
        wx: x,
        wy: y,
        ox: 0,
        oy: 0,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 14,
        size: 5 + Math.random() * 6,
        color: colors[i % colors.length],
        age: 0,
        life: 1.6 + Math.random() * 1.2,
      })
    }
  }

  setBadge(t, kind, text) {
    const key = kind + text
    if (t.shown.badge === key) return
    t.shown.badge = key
    t.badge.className = `spec-badge${kind ? ` ${kind}` : ''}`
    t.badge.textContent = text
    // Restart the entrance.
    if (kind === 'replay' || kind === 'win') t.badge.animate([{ opacity: 0, transform: 'translate(-50%, 14px) scale(0.9)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)' }], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1.2)' })
  }

  // ---- frame ---------------------------------------------------------------

  draw(now) {
    const e = this.e
    if (!e.gpu) return
    const dt = clamp(now - (this.prev || now), 0, 64)
    this.prev = now
    this.sync()
    this.layout()
    this.stepFocus(now)
    const quick = calm?.matches ? 1 : ease(dt, 130)
    const focus = this.focus
    for (const [client, t] of this.tiles) {
      const { el, to } = t
      if (!t.rect) t.rect = { ...to }
      if (!t.leaving) for (const k of ['x', 'y', 'w', 'h']) t.rect[k] += (to[k] - t.rect[k]) * quick
      t.a += ((t.leaving ? 0 : 1) - t.a) * (calm?.matches ? 1 : ease(dt, 150))
      if (t.leaving && t.a < 0.02) {
        el.remove()
        this.tiles.delete(client)
        continue
      }
      const r = t.rect
      const s = 0.86 + 0.14 * t.a
      el.style.width = `${r.w}px`
      el.style.height = `${r.h}px`
      el.style.transform = `translate(${r.x}px, ${r.y}px) scale(${s})`
      el.style.opacity = String(t.a)
      el.style.zIndex = focus?.tile === t ? '2' : '1'
      const dim = !!focus && focus.tile !== t
      if (t.shown.dim !== dim) {
        t.shown.dim = dim
        el.classList.toggle('dim', dim)
      }
      const name = t.client === '*' ? '' : t.cursor?.name || 'Someone'
      if (t.shown.name !== name) {
        t.shown.name = name
        t.label.textContent = name
        t.label.parentElement.hidden = !name
      }
      const color = t.cursor?.color || ''
      if (t.shown.color !== color) {
        t.shown.color = color
        if (color) el.style.setProperty('--c', color)
        else el.style.removeProperty('--c')
        t.dot.style.background = color
      }
      if (t.client === '*') this.setBadge(t, 'wait', 'Waiting for players')
      if (focus?.tile === t) this.focusCam(t, dt)
      else this.follow(t, dt)
    }

    // The screens that move: all of them, or just the one in focus (the others wait, frozen, so the
    // GPU canvas keeps one size).
    const pops = e.livePops()
    this.bursts = this.bursts.filter((b) => now - b.t0 < POP_MS)
    const replaying = focus?.phase === 'replay'
    for (const t of this.tiles.values()) {
      if (t.leaving || !t.cam) continue
      if (focus && focus.tile !== t && t.drawn) continue
      this.render(t, pops, replaying && focus.tile === t ? focus : null, dt)
    }
    e.cursorsDrawn = false
  }

  // Draws screen t: the table as its camera sees it, with pointers and bursts. replaying is the focus
  // while this screen shows its replay.
  render(t, pops, replaying, dt) {
    const e = this.e
    const { dpr } = e
    const w = Math.max(2, Math.round(t.to.w))
    const h = Math.max(2, Math.round(t.to.h))
    const W = Math.round(w * dpr)
    const H = Math.round(h * dpr)
    e.setGpuSize(W, H)
    if (t.canvas.width !== W || t.canvas.height !== H) {
      t.canvas.width = W
      t.canvas.height = H
    }
    const { cam, ctx } = t
    const v = { x: cam.x, y: cam.y, z: cam.z, w, h }
    if (replaying) e.withTrace(replaying.replay, replaying.u, () => e.drawGpu(v))
    else e.drawGpu(v)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(e.gpuEl, 0, 0)
    ctx.drawImage(e.gpuTop, 0, 0)
    e.paintCursors(ctx, cam, w, h, dpr)
    if (pops.length) e.paintPops(ctx, cam, w, h, pops, dpr)
    if (this.focus?.tile === t) {
      if (this.bursts.length) e.paintPops(ctx, cam, w, h, this.bursts, dpr, 2.6)
      this.paintConfetti(ctx, cam, w, h, dpr, dt)
    }
    t.drawn = true
  }

  paintConfetti(ctx, cam, w, h, dpr, dt) {
    if (!this.confetti.length) return
    const s = dt / 1000
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.confetti = this.confetti.filter((c) => (c.age += s) < c.life)
    for (const c of this.confetti) {
      c.vy += 1100 * s
      c.vx *= 1 - 0.8 * s
      c.ox += c.vx * s
      c.oy += c.vy * s
      c.rot += c.vr * s
      const x = (c.wx - cam.x) * cam.z + w / 2 + c.ox
      const y = (c.wy - cam.y) * cam.z + h / 2 + c.oy
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(c.rot)
      ctx.globalAlpha = Math.min(1, (c.life - c.age) / 0.5)
      ctx.fillStyle = c.color
      ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2)
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }
}
