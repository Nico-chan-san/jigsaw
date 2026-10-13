import { useCallback, useEffect, useRef, useState } from 'react'
import { cursorColor } from '../lib/engine.js'
import { formatTime } from '../lib/time.js'
import { useLinger } from '../lib/linger.js'
import { Clock, Crown, More, Piece } from './icons.jsx'
import PlayerDialog from './PlayerDialog.jsx'
import AccountDialog from './AccountDialog.jsx'

// At most this many circles in the header; everyone is in the menu behind the ... button.
const SHOWN = 5
// How long the pointer rests on a circle before its card shows (ms).
const HOVER_MS = 250

// Everyone who has done something in this jigsaw, most pieces connected first, then most time.
// Players are kept apart by id, since two of them can share a name.
export function rankPlayers({ stats, times, nameOf }) {
  const map = new Map()
  const get = (id) => {
    if (!map.has(id)) map.set(id, { id, name: nameOf(id), pieces: 0, seconds: 0 })
    return map.get(id)
  }
  for (const s of stats.values()) get(s.id).pieces = s.pieces
  for (const [id, seconds] of Object.entries(times)) if (seconds > 0) get(id).seconds = seconds

  return [...map.values()].sort(
    (a, b) =>
      b.pieces - a.pieces ||
      b.seconds - a.seconds ||
      a.name.localeCompare(b.name),
  )
}

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`

// A player's circle: the first two letters of their name on their cursor colour, ringed while
// they're here. With you, it carries a You tag.
export function Dot({ p, here, big = false, you = false }) {
  return (
    <span
      className={`player-dot${here ? ' online' : ''}${big ? ' big' : ''}${you ? ' you' : ''}`}
      style={{ '--c': cursorColor(p.id) }}
      aria-hidden="true"
    >
      {[...p.name].slice(0, 2).join('')}
    </span>
  )
}

// What shows while the pointer rests on a circle: who they are and what they've done here.
function HoverCard({ p, here, owner, me }) {
  return (
    <div className="player-card" role="tooltip">
      <div className="player-card-head">
        <Dot p={p} here={here} />
        <div>
          <div className="player-card-name">
            {p.name}
            {p.id === me && <span className="you-label"> (you)</span>}
          </div>
          <div className="player-card-sub">
            <span className={`presence${here ? ' here' : ''}`} />
            {here ? 'Here now' : 'Away'}
          </div>
        </div>
      </div>
      {p.id === owner && (
        <div className="player-card-row owner">
          <Crown />
          Made this jigsaw
        </div>
      )}
      <div className="player-card-row">
        <Piece />
        {plural(p.pieces, 'piece')} connected
      </div>
      <div className="player-card-row">
        <Clock />
        {formatTime(p.seconds)} spent
      </div>
    </div>
  )
}

// The players in the header: those here now as circles, by rank. The ... button opens a list of
// everyone, here now and away, and a circle or a name opens that player's window.
// owner is the id of the player who made the jigsaw, online a Set of the player ids here now.
export default function Players({ stats, times, me, owner, nameOf, online }) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileShown, profileClosing] = useLinger(profile)
  const closeProfile = useCallback(() => setProfile(null), [])
  // Your own window has a button to your account.
  const [account, setAccount] = useState(false)
  const [accountShown, accountClosing] = useLinger(account)
  const closeAccount = useCallback(() => setAccount(false), [])
  const openAccount = useCallback(() => {
    setProfile(null)
    setAccount(true)
  }, [])
  const wrap = useRef(null)
  const timer = useRef(0)
  const ranked = rankPlayers({ stats, times, nameOf })
  for (const id of online) {
    if (!ranked.some((p) => p.id === id)) ranked.push({ id, name: nameOf(id), pieces: 0, seconds: 0 })
  }
  // You come first among those here.
  const here = ranked.filter((p) => online.has(p.id)).sort((a, b) => (b.id === me) - (a.id === me))
  const away = ranked.filter((p) => !online.has(p.id))
  const list = [...here, ...away]
  const shown = here.slice(0, SHOWN)

  // Close on a press anywhere else, or Escape.
  useEffect(() => {
    if (!open) return
    const away = (e) => !wrap.current?.contains(e.target) && setOpen(false)
    const key = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  useEffect(() => () => clearTimeout(timer.current), [])

  const show = (id, now = false) => {
    clearTimeout(timer.current)
    if (now) setHover(id)
    else timer.current = setTimeout(() => setHover(id), HOVER_MS)
  }
  const hide = () => {
    clearTimeout(timer.current)
    setHover(null)
  }
  const openProfile = (p) => {
    hide()
    setOpen(false)
    setProfile(p)
  }
  // The window keeps up with the player's numbers here while it's open.
  const current = profileShown && (list.find((p) => p.id === profileShown.id) || profileShown)

  if (!list.length) return null
  return (
    <div className="players" ref={wrap}>
      <ul className="player-dots" aria-label="Players here now">
        {shown.map((p) => (
          <li key={p.id}>
            <button
              className="player-btn"
              onClick={() => openProfile(p)}
              onPointerEnter={(e) => e.pointerType === 'mouse' && show(p.id)}
              onPointerLeave={hide}
              onFocus={(e) => e.target.matches(':focus-visible') && show(p.id, true)}
              onBlur={hide}
              aria-label={`${p.name}${p.id === me ? ' (you)' : ''}`}
            >
              <Dot p={p} here={online.has(p.id)} you={p.id === me} />
            </button>
            {hover === p.id && !open && <HoverCard p={p} here={online.has(p.id)} owner={owner} me={me} />}
          </li>
        ))}
      </ul>
      {list.length > 0 && (
        <button
          className={`icon-btn more-btn${open ? ' on' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-label="All players"
          aria-expanded={open}
          data-tip={`All players (${list.length})`}
        >
          <More />
        </button>
      )}
      {open && (
        <div className="players-menu">
          <p className="players-total" title="Time spent by all players together">
            <Clock />
            Total time {formatTime(list.reduce((t, p) => t + p.seconds, 0))}
          </p>
          {[
            ['Here now', here],
            ['Away', away],
          ].map(
            ([title, group]) =>
              group.length > 0 && (
                <section key={title}>
                  <h2 className="label">
                    {title}
                    <span className="n">{group.length}</span>
                  </h2>
                  {group.map((p) => (
                    <button key={p.id} className={`players-row${p.id === me ? ' me' : ''}`} onClick={() => openProfile(p)}>
                      <Dot p={p} here={online.has(p.id)} />
                      <span className="pname">
                        {p.name}
                        {p.id === me && <span className="you-label"> you</span>}
                        {p.id === owner && (
                          <span className="powner" title="Made this jigsaw">
                            <Crown />
                          </span>
                        )}
                      </span>
                      <span className="pstat" title="Pieces connected">
                        <Piece />
                        {p.pieces}
                      </span>
                      <span className="pstat ptime" title="Time spent">
                        <Clock />
                        {formatTime(p.seconds)}
                      </span>
                    </button>
                  ))}
                </section>
              ),
          )}
        </div>
      )}
      {current && (
        <PlayerDialog
          p={current}
          here={online.has(current.id)}
          owner={owner}
          me={me}
          onAccount={openAccount}
          onClose={closeProfile}
          closing={profileClosing}
        />
      )}
      {accountShown && <AccountDialog onClose={closeAccount} closing={accountClosing} />}
    </div>
  )
}
