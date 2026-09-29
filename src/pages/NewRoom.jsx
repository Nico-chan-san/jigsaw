import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { SHAPES, buildPuzzle, gridFor, outlinePath, pile, samplePiecePath, scatter } from '../lib/geometry.js'
import { useApp } from '../App.jsx'
import { Arrow, Upload } from '../components/icons.jsx'
import InviteList from '../components/Invite.jsx'

const MIN = 4
const MAX = 4000
// The slider is logarithmic: 0..100 maps to MIN..MAX pieces.
const toCount = (v) => Math.round(Math.exp(Math.log(MIN) + ((Math.log(MAX) - Math.log(MIN)) * v) / 100))
const toSlider = (n) => ((Math.log(n) - Math.log(MIN)) / (Math.log(MAX) - Math.log(MIN))) * 100
const clampCount = (n) => Math.min(MAX, Math.max(MIN, Math.round(n)))
// The stored image's long side: 2400px, or more for big jigsaws so each piece keeps about 55px.
const maxSide = (cols, rows) => Math.min(4000, Math.max(2400, Math.max(cols, rows) * 55))

function loadImage(file) {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = fail
    img.src = url
  })
}

function encode(img, maxSide, quality) {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * k)
  c.height = Math.round(img.naturalHeight * k)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return { data: c.toDataURL('image/jpeg', quality), width: c.width, height: c.height }
}

function ShapeIcon({ shape }) {
  const d = useMemo(() => samplePiecePath(shape, 60), [shape])
  return (
    <svg viewBox="-24 -24 108 108" aria-hidden="true">
      <path
        d={d}
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Preview({ img, cols, rows, shape, seed }) {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    const box = c.parentElement.getBoundingClientRect()
    const k = Math.min(box.width / img.naturalWidth, 480 / img.naturalHeight)
    const w = Math.round(img.naturalWidth * k)
    const h = Math.round(img.naturalHeight * k)
    const dpr = window.devicePixelRatio || 1
    c.width = w * dpr
    c.height = h * dpr
    c.style.width = `${w}px`
    c.style.height = `${h}px`
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.drawImage(img, 0, 0, w, h)
    const geo = buildPuzzle({ cols, rows, width: w, height: h, shape, seed })
    ctx.lineWidth = 1
    ctx.lineJoin = 'round'
    for (const p of geo.pieces) {
      ctx.setTransform(dpr, 0, 0, dpr, p.cx * dpr, p.cy * dpr)
      const path = outlinePath(p.outline)
      ctx.strokeStyle = 'rgba(0,0,0,.45)'
      ctx.stroke(path)
      ctx.setTransform(dpr, 0, 0, dpr, (p.cx + 0.6) * dpr, (p.cy + 0.6) * dpr)
      ctx.strokeStyle = 'rgba(255,255,255,.35)'
      ctx.stroke(path)
    }
  }, [img, cols, rows, shape, seed])
  return <canvas ref={ref} />
}

// The new jigsaw form, shown inside the jigsaws window.
export default function NewRoom() {
  const { requireName, currentPlayer, openRoom } = useApp()
  const [img, setImg] = useState(null)
  const [name, setName] = useState('')
  // Pieces asked for, by slider or typed. The jigsaw gets the closest grid to it.
  const [count, setCount] = useState(() => toCount(44))
  // What's in the number field while typing; null shows the actual piece count.
  const [typed, setTyped] = useState(null)
  const [shape, setShape] = useState('classic')
  const [hardcore, setHardcore] = useState(false)
  const [hidden, setHidden] = useState(false)
  // Players to email the private jigsaw's link to, by id.
  const [invited, setInvited] = useState(() => new Set())
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')
  const [fetching, setFetching] = useState(false)
  const [linkError, setLinkError] = useState(false)
  const [seed] = useState(() => (Math.random() * 2 ** 31) | 0)
  const input = useRef(null)

  const grid = gridFor(count, img?.naturalWidth || 4, img?.naturalHeight || 3)
  const slider = toSlider(count)

  // Pasted images get a generic file name like "image.png", so they don't set the title.
  const pick = async (file, named = true) => {
    if (!file || !file.type.startsWith('image/')) return
    const image = await loadImage(file)
    setImg(image)
    if (named && !name)
      setName(
        file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[-_]+/g, ' ')
          .slice(0, 60),
      )
  }

  // Paste an image anywhere on the page. In a text field, text still pastes as usual.
  const pickRef = useRef(pick)
  pickRef.current = pick
  useEffect(() => {
    const paste = (e) => {
      const data = e.clipboardData
      const file = [...(data?.files || [])].find((f) => f.type.startsWith('image/'))
      if (!file) return
      if (e.target?.closest?.('input, textarea') && data.types.includes('text/plain')) return
      e.preventDefault()
      pickRef.current(file, false)
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [])

  const fromLink = async (e) => {
    e.preventDefault()
    const url = link.trim()
    if (!url || fetching) return
    setFetching(true)
    setLinkError(false)
    try {
      const res = await fetch(`/api/image?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error()
      const image = await loadImage(await res.blob())
      setImg(image)
      if (!name) {
        const base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '')
        setName(
          base
            .replace(/\.[^.]+$/, '')
            .replace(/[-_]+/g, ' ')
            .slice(0, 60),
        )
      }
    } catch {
      setLinkError(true)
    } finally {
      setFetching(false)
    }
  }

  const create = async () => {
    if (!img || busy) return
    if (!(await requireName())) return
    setBusy(true)
    try {
      const full = encode(img, maxSide(grid.cols, grid.rows), 0.9)
      const thumb = encode(img, 480, 0.8)
      const room = { cols: grid.cols, rows: grid.rows, width: full.width, height: full.height, shape, seed }
      const { id } = await api.create({
        ...room,
        name: name.trim() || 'Jigsaw',
        image: full.data,
        thumb: thumb.data,
        annoying: hardcore,
        private: hidden,
        invite: hidden ? [...invited] : [],
        pieces: hardcore ? pile(room) : scatter(room),
        passphrase: currentPlayer()?.passphrase,
      })
      openRoom(id)
    } catch {
      setBusy(false)
    }
  }

  return (
    <section className="create">
        <section className="field">
          <h2 className="label">Title</h2>
          <input
            className="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Title"
            maxLength={60}
            aria-label="Title"
            title="Title"
          />
        </section>

        <section className="field">
          <h2 className="label">Image</h2>
          <div
            className={`drop${over ? ' over' : ''}${img ? ' has' : ''}`}
            onClick={() => input.current.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current.click()}
            role="button"
            tabIndex={0}
            title={img ? 'Change image (or paste one)' : 'Upload, drop or paste an image'}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              pick(e.dataTransfer.files[0])
            }}
          >
            {img ? (
              <Preview img={img} {...grid} shape={shape} seed={seed} />
            ) : (
              <span className="drop-empty">
                <span className="drop-icon">
                  <Upload className="big" />
                </span>
                <span className="drop-hint">Click to upload, drop an image here, or just paste one</span>
              </span>
            )}
            <input ref={input} type="file" accept="image/*" onChange={(e) => pick(e.target.files[0])} />
          </div>
          <div className="or" aria-hidden="true">
            or
          </div>
          <form className="row" onSubmit={fromLink}>
            <input
              className={`text${linkError ? ' bad' : ''}`}
              type="url"
              value={link}
              onChange={(e) => {
                setLink(e.target.value)
                setLinkError(false)
              }}
              placeholder="Link to image"
              aria-label="Link to image"
              title="Link to image"
            />
            <button className="secondary" disabled={!link.trim() || fetching} title="Load image">
              {fetching ? <span className="spin" /> : 'Load'}
            </button>
          </form>
        </section>

        <section className="field">
          <h2 className="label">Pieces</h2>
          <div className="row slider">
            <input
              type="range"
              style={{ '--p': `${slider}%` }}
              min="0"
              max="100"
              value={slider}
              onChange={(e) => {
                setCount(toCount(+e.target.value))
                setTyped(null)
              }}
              aria-label="Pieces"
              title="Number of pieces"
            />
            <input
              className="num"
              type="text"
              inputMode="numeric"
              value={typed ?? grid.cols * grid.rows}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 4)
                setTyped(v)
                if (+v >= MIN) setCount(clampCount(+v))
              }}
              onFocus={(e) => e.target.select()}
              onBlur={() => {
                if (typed && +typed) setCount(clampCount(+typed))
                setTyped(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-label="Number of pieces"
              title={`Type a number of pieces, ${MIN} to ${MAX}`}
            />
          </div>
        </section>

        <section className="field">
          <h2 className="label">Shape</h2>
          <div className="shapes">
            {SHAPES.map((s) => (
              <button
                key={s}
                className={`shape${s === shape ? ' on' : ''}`}
                onClick={() => setShape(s)}
                aria-label={s}
                title={s[0].toUpperCase() + s.slice(1)}
              >
                <ShapeIcon shape={s} />
              </button>
            ))}
          </div>
        </section>

        <section className="field">
          <h2 className="label">Mode</h2>
          <button
            className={`toggle${hardcore ? ' on' : ''}`}
            role="switch"
            aria-checked={hardcore}
            onClick={() => setHardcore((v) => !v)}
            title="Hardcore mode"
          >
            <span className="toggle-text">
              <span>Hardcore mode</span>
              <span className="toggle-hint">All pieces start in one messy pile, many face down. Click a piece to turn it face up.</span>
            </span>
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-knob" />
            </span>
          </button>
        </section>

        <section className="field">
          <h2 className="label">Visibility</h2>
          <button
            className={`toggle${hidden ? ' on' : ''}`}
            role="switch"
            aria-checked={hidden}
            onClick={() => setHidden((v) => !v)}
            title="Private room"
          >
            <span className="toggle-text">
              <span>Private room</span>
              <span className="toggle-hint">Only people with the link can see and play this jigsaw.</span>
            </span>
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-knob" />
            </span>
          </button>
        </section>

        {hidden && (
          <section className="field">
            <h2 className="label">Invite players</h2>
            <InviteList selected={invited} onChange={setInvited} />
          </section>
        )}

        <button
          className="primary wide"
          onClick={create}
          disabled={!img || busy}
          title={img ? 'Create jigsaw' : 'Add an image first'}
        >
          {busy ? (
            <span className="spin" />
          ) : (
            <>
              Create jigsaw
              <Arrow />
            </>
          )}
        </button>
    </section>
  )
}
