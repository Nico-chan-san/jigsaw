// Jigsaw geometry: grid sizing, edge shapes, piece outlines and initial scatter.

export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const SHAPES = ['classic', 'round', 'dovetail', 'arrow', 'wave', 'square']

// Max perpendicular reach of a tab, in units of the piece's short side.
export const TAB_REACH = 0.4

export function gridFor(count, width, height) {
  const aspect = width / height
  let cols = Math.max(2, Math.round(Math.sqrt(count * aspect)))
  let rows = Math.max(2, Math.round(count / cols))
  return { cols, rows }
}

// ---- edge profiles --------------------------------------------------------
// Each profile returns [u, v] points with u in [0, 1] along the edge and v the
// perpendicular offset in units of the piece's short side.

function cubic(out, p0, p1, p2, p3, steps) {
  for (let s = 1; s <= steps; s++) {
    const t = s / steps
    const m = 1 - t
    const a = m * m * m
    const b = 3 * m * m * t
    const c = 3 * m * t * t
    const d = t * t * t
    out.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ])
  }
}

const j = (r, amount) => (r() * 2 - 1) * amount

const profiles = {
  classic(r) {
    const t = 0.1
    const a = j(r, 0.04)
    const b = j(r, 0.04)
    const c = j(r, 0.03)
    const d = j(r, 0.03)
    const e = j(r, 0.04)
    const p = [
      [0, 0],
      [0.2, a],
      [0.5 + b + d, -t + c],
      [0.5 - t + b, t + c],
      [0.5 - 2 * t + b - d, 3 * t + c],
      [0.5 + 2 * t + b - d, 3 * t + c],
      [0.5 + t + b, t + c],
      [0.5 + b + d, -t + c],
      [0.8, e],
      [1, 0],
    ]
    const out = [p[0]]
    cubic(out, p[0], p[1], p[2], p[3], 10)
    cubic(out, p[3], p[4], p[5], p[6], 14)
    cubic(out, p[6], p[7], p[8], p[9], 10)
    return out
  },
  round(r) {
    const cu = 0.5 + j(r, 0.05)
    const c = 0.1
    const R = 0.16
    const du = Math.sqrt(R * R - c * c)
    const t1 = Math.atan2(-c, -du)
    const t2 = Math.atan2(-c, du)
    const span = Math.PI * 2 - (t2 - t1)
    const out = [[0, 0]]
    const steps = 28
    for (let s = 0; s <= steps; s++) {
      const th = t1 - (span * s) / steps
      out.push([cu + R * Math.cos(th), c + R * Math.sin(th)])
    }
    out.push([1, 0])
    return out
  },
  dovetail(r) {
    const b = j(r, 0.05)
    return [
      [0, 0],
      [0.39 + b, 0],
      [0.31 + b, 0.24],
      [0.69 + b, 0.24],
      [0.61 + b, 0],
      [1, 0],
    ]
  },
  arrow(r) {
    const b = j(r, 0.05)
    return [
      [0, 0],
      [0.42 + b, 0],
      [0.42 + b, 0.08],
      [0.32 + b, 0.08],
      [0.5 + b, 0.28],
      [0.68 + b, 0.08],
      [0.58 + b, 0.08],
      [0.58 + b, 0],
      [1, 0],
    ]
  },
  wave(r) {
    const amp = 0.09 + j(r, 0.02)
    const h2 = j(r, 0.03)
    const out = []
    const steps = 32
    for (let s = 0; s <= steps; s++) {
      const u = s / steps
      out.push([u, amp * Math.sin(Math.PI * 2 * u) + h2 * Math.sin(Math.PI * 4 * u)])
    }
    return out
  },
  square() {
    return [
      [0, 0],
      [1, 0],
    ]
  },
}

// ---- jigsaw layout ---------------------------------------------------------

// Builds outlines for every piece. Coordinates are in image pixels, relative to
// the centre of the piece's grid cell. Outlines run clockwise (y down).
export function buildPuzzle({ cols, rows, width, height, shape, seed }) {
  const w = width / cols
  const h = height / rows
  const S = Math.min(w, h)
  const r = rng(seed)
  const profile = profiles[shape] || profiles.classic

  // Horizontal edges between row y-1 and y, vertical edges between col x-1 and x.
  const H = []
  for (let y = 0; y <= rows; y++) {
    H.push([])
    for (let x = 0; x < cols; x++) {
      const x0 = x * w
      const y0 = y * h
      if (y === 0 || y === rows) {
        H[y].push([[x0, y0], [x0 + w, y0]])
      } else {
        const sign = r() < 0.5 ? -1 : 1
        H[y].push(profile(r).map(([u, v]) => [x0 + u * w, y0 + v * S * sign]))
      }
    }
  }
  const V = []
  for (let y = 0; y < rows; y++) {
    V.push([])
    for (let x = 0; x <= cols; x++) {
      const x0 = x * w
      const y0 = y * h
      if (x === 0 || x === cols) {
        V[y].push([[x0, y0], [x0, y0 + h]])
      } else {
        const sign = r() < 0.5 ? -1 : 1
        V[y].push(profile(r).map(([u, v]) => [x0 + v * S * sign, y0 + u * h]))
      }
    }
  }

  const pieces = []
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cx = x * w + w / 2
      const cy = y * h + h / 2
      const pts = []
      const add = (edge, reverse) => {
        const e = reverse ? [...edge].reverse() : edge
        for (let k = pts.length ? 1 : 0; k < e.length; k++) pts.push(e[k][0] - cx, e[k][1] - cy)
      }
      add(H[y][x], false)
      add(V[y][x + 1], false)
      add(H[y + 1][x], true)
      add(V[y][x], true)
      pieces.push({ i: y * cols + x, col: x, row: y, cx, cy, outline: Float32Array.from(pts) })
    }
  }
  return { w, h, S, pad: S * TAB_REACH, pieces }
}

export function outlinePath(outline) {
  const p = new Path2D()
  p.moveTo(outline[0], outline[1])
  for (let k = 2; k < outline.length; k += 2) p.lineTo(outline[k], outline[k + 1])
  p.closePath()
  return p
}

// Spreads pieces out in a loose grid of slots so none overlap, each with a
// random quarter-turn rotation.
export function scatter({ cols, rows, width, height, seed }) {
  const n = cols * rows
  const w = width / cols
  const h = height / rows
  const S = Math.min(w, h)
  const r = rng(seed ^ 0x9e3779b9)
  const slot = Math.max(w, h) + 2 * S * TAB_REACH + S * 0.35
  const sc = Math.ceil(Math.sqrt(n * 1.6))
  const sr = Math.ceil(n / sc)
  const slots = Array.from({ length: sc * sr }, (_, k) => k)
  for (let k = slots.length - 1; k > 0; k--) {
    const m = Math.floor(r() * (k + 1))
    ;[slots[k], slots[m]] = [slots[m], slots[k]]
  }
  const jit = S * 0.15
  return Array.from({ length: n }, (_, i) => {
    const s = slots[i]
    return {
      i,
      x: ((s % sc) - (sc - 1) / 2) * slot + (r() * 2 - 1) * jit,
      y: (Math.floor(s / sc) - (sr - 1) / 2) * slot + (r() * 2 - 1) * jit,
      r: Math.floor(r() * 4),
      g: i,
    }
  })
}

// SVG path for a single sample piece (used by the shape picker icon).
export function samplePiecePath(shape, size = 100) {
  const profile = profiles[shape] || profiles.classic
  const fixed = () => 0.5
  const e = profile(fixed)
  const pts = []
  const push = (x, y) => pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`)
  // top out, right in, bottom out, left in
  for (const [u, v] of e) push(u * size, -v * size)
  for (const [u, v] of e) push(size - v * size, u * size)
  for (const [u, v] of [...e].reverse()) push(u * size, size + v * size)
  for (const [u, v] of [...e].reverse()) push(v * size, u * size)
  return 'M' + pts.join('L') + 'Z'
}
