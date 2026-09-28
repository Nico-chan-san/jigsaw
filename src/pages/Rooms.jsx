import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { ThemeButton, navigate, store, useApp } from '../App.jsx'
import { Check, Clock, Plus, Trash } from '../components/icons.jsx'
import { formatTime } from '../lib/time.js'

function Who() {
  const { name, setName, requireName } = useApp()
  const [edit, setEdit] = useState(false)
  const [value, setValue] = useState(name || '')
  if (!name) {
    return (
      <button className="who" onClick={requireName} title="Set your name">
        Set name
      </button>
    )
  }
  if (!edit) {
    return (
      <button
        className="who"
        onClick={() => {
          setValue(name)
          setEdit(true)
        }}
        title="Change name"
      >
        {name}
      </button>
    )
  }
  const done = () => {
    if (value.trim()) setName(value.trim().slice(0, 32))
    else setValue(name)
    setEdit(false)
  }
  return (
    <input
      className="who-input"
      autoFocus
      value={value}
      maxLength={32}
      onChange={(e) => setValue(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => e.key === 'Enter' && done()}
      aria-label="Name" title="Name"
    />
  )
}

function Card({ r, onDelete }) {
  return (
    <a className={`card${r.done ? ' done' : ''}`} href={`#/r/${r.id}`} title={r.name}>
      <div className="thumb-wrap">
        <img className="thumb" src={r.thumb} alt="" loading="lazy" />
        {r.done && (
          <div className="done-overlay" title="Complete">
            <span className="done-badge">
              <Check />
            </span>
            <span className="done-time" title="Total time spent">
              {formatTime(r.seconds || 0)}
            </span>
          </div>
        )}
      </div>
      <div className="progress">
        <div style={{ width: `${Math.round(r.progress * 100)}%` }} />
      </div>
      <div className="meta">
        <span className="name">{r.name}</span>
        <span className="count">
          {!r.done && (
            <span className="time" title="Total time spent">
              <Clock />
              {formatTime(r.seconds || 0)}
            </span>
          )}
          <span title="Pieces">{r.n}</span>
        </span>
      </div>
      <button className="icon-btn del" onClick={(e) => onDelete(e, r)} aria-label="Delete" title="Delete jigsaw">
        <Trash />
      </button>
    </a>
  )
}

const SECTIONS = [
  { title: 'In progress', test: (r) => !r.done },
  { title: 'Finished', test: (r) => r.done },
]

export default function RoomsPage() {
  const [rooms, setRooms] = useState(null)

  const load = () => api.rooms().then(setRooms).catch(() => setRooms([]))
  useEffect(() => {
    load()
  }, [])

  const remove = async (e, room) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete "${room.name}"?`)) return
    await api.remove(room.id)
    if (store.get('lastRoom') === room.id) store.set('lastRoom', null)
    load()
  }

  return (
    <div className="page">
      <div className="bar">
        <div className="title">
          <h1>Jigsaws</h1>
        </div>
        <div className="right">
          <Who />
          <ThemeButton />
        </div>
      </div>
      <section className="rooms-section">
        <h2>New</h2>
        <div className="grid">
          <button className="card new" onClick={() => navigate('/new')} aria-label="New jigsaw" title="New jigsaw">
            <Plus />
          </button>
        </div>
      </section>
      {SECTIONS.map(({ title, test }) => {
        const list = rooms?.filter(test) || []
        if (!list.length) return null
        return (
          <section key={title} className="rooms-section">
            <h2>
              {title}
              <span className="n">{list.length}</span>
            </h2>
            <div className="grid">
              {list.map((r) => (
                <Card key={r.id} r={r} onDelete={remove} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
