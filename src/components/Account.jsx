import { useEffect, useState } from 'react'
import { Arrow } from './icons.jsx'

// The player's passphrase as four word chips.
export function Passphrase({ value }) {
  return (
    <span className="passphrase">
      {String(value || '')
        .split(' ')
        .map((w, i) => (
          <span key={i} className="word">
            {w}
          </span>
        ))}
    </span>
  )
}

// Modal for signing up with a name ('name'), logging in with a passphrase ('login'), and showing a
// new passphrase ('show', after signing up, or with player given). 'returning' greets someone whose
// browser knew them only by name (from before passphrases) when that name already has a
// passphrase: they log in with it, or start fresh. onSignUp and onLogin resolve with the player.
export default function AccountPrompt({ mode: start, name, player, onSignUp, onLogin, onDone, onCancel }) {
  const [mode, setMode] = useState(start)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState(player || null)

  // Escape never throws away a player that was just made.
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && (mode === 'show' ? onDone(made) : onCancel())
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [mode, made, onDone, onCancel])

  const fresh = async () => {
    setBusy(true)
    try {
      setMade(await onSignUp(name))
      setMode('show')
    } catch {
      setError('Could not save your name, try again')
    } finally {
      setBusy(false)
    }
  }

  const switchTo = (m) => {
    setMode(m)
    setValue('')
    setError('')
  }

  const submit = async (e) => {
    e.preventDefault()
    const v = value.trim()
    if (!v || busy) return
    setBusy(true)
    setError('')
    try {
      if (mode !== 'name') onDone(await onLogin(v))
      else {
        setMade(await onSignUp(v.slice(0, 32)))
        setMode('show')
      }
    } catch (err) {
      setError(mode !== 'name' ? err.message || 'Unknown passphrase' : 'Could not save your name, try again')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'show') {
    return (
      <div className="modal-bg">
        <div className="modal">
          <h1>Your passphrase</h1>
          <p className="modal-text">
            {player && 'Players now log in with a passphrase, and this one is yours. '}
            Keep these four words somewhere safe. They are your login: use them to play as {made.name} on another
            device, or after logging out. You can always find them under Account.
          </p>
          <Passphrase value={made.passphrase} />
          <button className="primary wide" autoFocus onClick={() => onDone(made)}>
            Got it
            <Arrow />
          </button>
        </div>
      </div>
    )
  }

  const returning = mode === 'returning'
  const login = mode === 'login' || returning
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal" onSubmit={submit}>
        <h1>{returning ? `Welcome back, ${name}` : login ? 'Log in' : 'Your name'}</h1>
        {returning && (
          <p className="modal-text">
            Players now log in with a four word passphrase. {name} already has one, from another device. Find it
            under Account there, and enter it here to keep your progress.
          </p>
        )}
        {mode === 'login' && (
          <p className="modal-text">Enter the four word passphrase you got when you first picked a name.</p>
        )}
        <div className="row">
          <input
            className={`text${error ? ' bad' : ''}`}
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError('')
            }}
            placeholder={login ? 'four word passphrase' : 'Name'}
            maxLength={login ? 200 : 32}
            autoCapitalize="none"
            autoComplete={login ? 'current-password' : 'nickname'}
            spellCheck={false}
            aria-label={login ? 'Passphrase' : 'Name'}
            title={login ? 'Passphrase' : 'Name'}
          />
          <button className="primary" disabled={!value.trim() || busy} title={login ? 'Log in' : 'Continue'}>
            {busy ? <span className="spin" /> : login ? 'Log in' : 'Continue'}
            {!busy && <Arrow />}
          </button>
        </div>
        {error && <p className="modal-error">{error}</p>}
        {returning ? (
          <button type="button" className="link" onClick={fresh} disabled={busy}>
            Not you, or no other device? Start fresh as a new {name}
          </button>
        ) : (
          <button type="button" className="link" onClick={() => switchTo(login ? 'name' : 'login')}>
            {login ? 'New here? Pick a name instead' : 'Played before? Log in with your passphrase'}
          </button>
        )}
      </form>
    </div>
  )
}
