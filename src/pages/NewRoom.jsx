import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { SHAPES, buildPuzzle, gridFor, outlinePath, samplePiecePath, scatter } from '../lib/geometry.js'
import { ThemeButton, navigate, useApp } from '../App.jsx'
import { Arrow, Back, Upload } from '../components/icons.jsx'

const MIN = 4
const MAX = 1000
const toCount = (v) => Math.round(Math.exp(Math.log(MIN) + ((Math.log(MAX) - Math.log(MIN)) * v) / 100))
const MAX_SIDE = 2400

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

export default function NewRoom() {
  const { requireName } = useApp()
  const [img, setImg] = useState(null)
  const [name, setName] = useState('')
  const [slider, setSlider] = useState(55)
  const [shape, setShape] = useState('classic')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')
  const [fetching, setFetching] = useState(false)
  const [linkError, setLinkError] = useState(false)
  const [seed] = useState(() => (Math.random() * 2 ** 31) | 0)
  const input = useRef(null)

  const grid = gridFor(toCount(slider), img?.naturalWidth || 4, img?.naturalHeight || 3)

  const pick = async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const image = await loadImage(file)
    setImg(image)
    if (!name)
      setName(
        file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[-_]+/g, ' ')
          .slice(0, 60),
      )
  }

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
      const full = encode(img, MAX_SIDE, 0.9)
      const thumb = encode(img, 480, 0.8)
      const room = { cols: grid.cols, rows: grid.rows, width: full.width, height: full.height, shape, seed }
      const { id } = await api.create({
        ...room,
        name: name.trim() || 'Jigsaw',
        image: full.data,
        thumb: thumb.data,
        pieces: scatter(room),
      })
      navigate(`/r/${id}`)
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="bar">
        <div className="title">
          <button
            className="icon-btn"
            onClick={() => navigate('/rooms')}
            aria-label="Back"
            title="Back to rooms"
          >
            <Back />
          </button>
          <h1>New jigsaw</h1>
        </div>
        <ThemeButton />
      </div>
      <div className="create">
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
            title={img ? 'Change image' : 'Upload image'}
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
              <span className="drop-icon">
                <Upload className="big" />
              </span>
            )}
            <input ref={input} type="file" accept="image/*" onChange={(e) => pick(e.target.files[0])} />
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
              onChange={(e) => setSlider(+e.target.value)}
              aria-label="Pieces"
              title="Number of pieces"
            />
            <span className="num">{grid.cols * grid.rows}</span>
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
      </div>
    </div>
  )
}
