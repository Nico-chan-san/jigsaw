import { formatTime } from '../lib/time.js'
import { Clock, Note, Piece } from './icons.jsx'

// Everyone who has done something in this jigsaw, most pieces connected first, then most time.
// Players are kept apart by id, since two of them can share a name.
export function rankPlayers({ stats, times, notes, nameOf }) {
  const map = new Map()
  const get = (id) => {
    if (!map.has(id)) map.set(id, { id, name: nameOf(id), pieces: 0, seconds: 0, notes: 0 })
    return map.get(id)
  }
  for (const s of stats.values()) get(s.id).pieces = s.pieces
  for (const [id, seconds] of Object.entries(times)) if (seconds > 0) get(id).seconds = seconds
  for (const n of notes) if (n.author) get(n.author).notes++

  return [...map.values()].sort(
    (a, b) =>
      b.pieces - a.pieces ||
      b.seconds - a.seconds ||
      a.name.localeCompare(b.name),
  )
}

export default function Players({ open, stats, times, notes, me, nameOf }) {
  const list = rankPlayers({ stats, times, notes, nameOf })

  return (
    <aside className={`players${open ? ' open' : ''}`}>
      <h2 className="label">Players</h2>
      <ol>
        {list.map((p) => (
          <li key={p.id} className={p.id === me ? 'me' : ''}>
            <span className="pname" title={p.name}>
              {p.name}
            </span>
            <span className="pstats">
              <span title="Pieces connected">
                <Piece />
                {p.pieces}
              </span>
              <span className="ptime" title="Time spent">
                <Clock />
                {formatTime(p.seconds)}
              </span>
            </span>
            {p.notes > 0 && (
              <span className="psub">
                <span title="Notes written">
                  <Note />
                  {p.notes}
                </span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </aside>
  )
}
