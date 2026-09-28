import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { navigate, store, useApp } from '../App.jsx'
import { Check, Clock, Plus, Trash } from '../components/icons.jsx'
import Sheet from '../components/Sheet.jsx'
import NewRoom from './NewRoom.jsx'
import Confirm from '../components/Confirm.jsx'
import { formatTime } from '../lib/time.js'

function Card({ r, mine, onOpen, onDelete }) {
  return (
    <a
      className={`card${r.done ? ' done' : ''}`}
      href={`/r/${r.id}`}
      title={r.name}
      onClick={(e) => {
        // Modified clicks still open the jigsaw in a new tab or window.
        if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        onOpen(r.id)
      }}
    >
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
      {mine && (
        <button className="icon-btn del" onClick={(e) => onDelete(e, r)} aria-label="Delete" title="Delete jigsaw">
          <Trash />
        </button>
      )}
    </a>
  )
}

const SECTIONS = [
  { title: 'In progress', test: (r) => !r.done },
  { title: 'Finished', test: (r) => r.done },
]

// One window for the jigsaw list and the new jigsaw form: view is 'rooms' or 'new', and New
// switches it in place, with a back button, rather than opening another window.
export default function RoomsDialog({ view, setView, closing, onClose }) {
  const { roomId, openRoom, player, playerId, openLogin } = useApp()
  const [rooms, setRooms] = useState(null)

  const load = () => api.rooms().then(setRooms).catch(() => setRooms([]))
  useEffect(() => {
    load()
  }, [])

  // The jigsaw waiting for a yes in the delete dialog.
  const [doomed, setDoomed] = useState(null)
  const keep = useCallback(() => setDoomed(null), [])
  const ask = (e, room) => {
    e.preventDefault()
    e.stopPropagation()
    setDoomed(room)
  }

  const remove = async (room) => {
    setDoomed(null)
    try {
      await api.remove(room.id, player?.passphrase)
    } catch {
      return load()
    }
    if (store.get('lastRoom') === room.id) store.set('lastRoom', null)
    if (roomId === room.id) navigate('/rooms')
    load()
  }

  return (
    <Sheet
      title={view === 'new' ? 'New jigsaw' : 'Jigsaws'}
      onBack={view === 'new' ? () => setView('rooms') : null}
      onClose={onClose}
      closing={closing}
      right={
        !player && (
          <button className="secondary small" onClick={openLogin} title="Log in with your passphrase">
            Log in
          </button>
        )
      }
    >
      {view === 'new' ? (
        <NewRoom />
      ) : (
        <>
          <section className="rooms-section">
            <h2>New</h2>
            <div className="grid">
              <button className="card new" onClick={() => setView('new')} aria-label="New jigsaw" title="New jigsaw">
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
                    <Card key={r.id} r={r} mine={!!playerId && r.owner === playerId} onOpen={openRoom} onDelete={ask} />
                  ))}
                </div>
              </section>
            )
          })}
        </>
      )}
      {doomed && (
        <Confirm
          title={`Delete "${doomed.name}"?`}
          text="The jigsaw and everything on its table goes for everyone. This can't be undone."
          action="Delete"
          danger
          onCancel={keep}
          onConfirm={() => remove(doomed)}
        />
      )}
    </Sheet>
  )
}
