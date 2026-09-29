import { formatTime } from '../lib/time.js'
import { Clock, Crown, Note, Piece } from './icons.jsx'

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

// owner is the id of the player who made the jigsaw, marked with a crown.
export default function Players({ open, stats, times, notes, me, owner, nameOf }) {
  const list = rankPlayers({ stats, times, notes, nameOf })

  return (
    <aside className={`players${open ? ' open' : ''}`}>
      <h2 className="label">Players</h2>
      <ol>
        {list.map((p) => (
          <li key={p.id} className={p.id === me ? 'me' : ''}>
            <span className="pname" title={p.id === owner ? `${p.name}, made this jigsaw` : p.name}>
              {p.id === owner && (
                <span className="pcreator" title={`${p.name} created this room`}>
                  <Crown />
                </span>
              )}
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
