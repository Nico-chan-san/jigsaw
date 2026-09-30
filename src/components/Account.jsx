import { Fragment, useEffect, useState } from 'react'
import { Arrow, Check, Copy } from './icons.jsx'
import TextField from './TextField.jsx'
import Dialog, { Tabs } from './Dialog.jsx'

// The player's passphrase as four word chips, with a button that copies it.
export function Passphrase({ value }) {
  const text = String(value || '')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {}
  }

  return (
    <span className="passphrase">
      {/* Real spaces between the chips, so selecting and copying the words keeps them apart. */}
      {text.split(' ').map((w, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="word">{w}</span>
        </Fragment>
      ))}{' '}
      <button
        type="button"
        className={`icon-btn copy-btn${copied ? ' on' : ''}`}
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy passphrase'}
        title={copied ? 'Copied' : 'Copy passphrase'}
      >
        {copied ? <Check /> : <Copy />}
      </button>
    </span>
  )
}

// Email and password fields with a submit button. onSubmit(email, password) rejects with the
// reason it failed, which is shown under the fields. With create, the password is a new one.
export function EmailForm({ action, create = false, onSubmit }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!email.trim() || !password || busy) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(email.trim(), password)
    } catch (err) {
      setError(err.message || 'Something went wrong, try again')
      setBusy(false)
    }
  }

  return (
    <form className="email-form" onSubmit={submit}>
      <TextField
        bad={!!error}
        type="email"
        autoFocus
        value={email}
        onChange={(e) => (setEmail(e.target.value), setError(''))}
        placeholder="Email"
        autoCapitalize="none"
        autoComplete="email"
        spellCheck={false}
        maxLength={254}
        aria-label="Email"
        title="Email"
      />
      <TextField
        bad={!!error}
        type="password"
        value={password}
        onChange={(e) => (setPassword(e.target.value), setError(''))}
        placeholder={create ? 'Password, at least 8 characters' : 'Password'}
        autoComplete={create ? 'new-password' : 'current-password'}
        aria-label="Password"
        title="Password"
      />
      {error && <p className="modal-error">{error[0].toUpperCase() + error.slice(1)}</p>}
      <button className="primary wide" disabled={!email.trim() || !password || busy} title={action}>
        {busy ? <span className="spin" /> : action}
        {!busy && <Arrow />}
      </button>
    </form>
  )
}

// True for a name that is four words with spaces between, like a passphrase.
export const looksLikePassphrase = (name) => /^\s*[a-z]+(\s+[a-z]+){3}\s*$/i.test(name)

// Shown under a name field whose value looks like a passphrase, since names are seen by everyone.
export function PassphraseWarning({ value }) {
  if (!looksLikePassphrase(value)) return null
  return (
    <p className="modal-error">
      This looks like a passphrase. Your name is shown to everyone, so never put your passphrase in it.
    </p>
  )
}

// The three ways in, as tabs under the login dialog's title.
const TABS = [
  { key: 'name', title: 'New player', hint: 'Pick a name' },
  { key: 'login', title: 'Passphrase', hint: 'Log in with your passphrase' },
  { key: 'email', title: 'Email', hint: 'Log in with email and password' },
]

// Modal for signing up with a name ('name'), logging in with a passphrase ('login') or with an
// email and password ('email'), one tab each, and showing a new passphrase ('show', after signing
// up, or with player given). 'returning' greets someone whose browser knew them only by name (from
// before passphrases) when that name already has a passphrase: they log in with it, or start fresh.
// onSignUp, onLogin and onLoginEmail resolve with the player.
export default function AccountPrompt({ mode: start, name, player, onSignUp, onLogin, onLoginEmail, onDone, onCancel }) {
  // Log in opens on the first tab too, New player.
  const [mode, setMode] = useState(start === 'login' ? 'name' : start)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState(player || null)

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

  const returning = mode === 'returning'
  const login = mode === 'login' || returning
  // Enter won't continue with a name that looks like a passphrase, but the button still will.
  const blocked = !login && looksLikePassphrase(value)

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
    // Escape or a press outside never throws away a player that was just made.
    return (
      <Dialog title="Your passphrase" className="prompt" onClose={() => onDone(made)} closeButton={false}>
        <p className="modal-text">
          {player && 'Players now log in with a passphrase, and this one is yours. '}
          Keep these four words somewhere safe. They are your login: use them to play as {made.name} on another
          device, or after logging out. You can always find them under Account.
        </p>
        <Passphrase value={made.passphrase} />
        <button type="button" className="primary wide" autoFocus onClick={() => onDone(made)}>
          Got it
          <Arrow />
        </button>
      </Dialog>
    )
  }

  const tabs = !returning && (
    <div className="dialog-tabs">
      <Tabs tabs={TABS} value={mode} onChange={switchTo} label="Log in or sign up" />
    </div>
  )

  // One dialog for every tab, so switching tabs only changes what's in it.
  return (
    <Dialog title={returning ? `Welcome back, ${name}` : 'Log in'} className="prompt" onClose={onCancel}>
      {tabs}
      {mode === 'email' ? (
        <>
          <p className="modal-text">Enter the email and password you switched your account to.</p>
          <EmailForm action="Log in" onSubmit={async (email, password) => onDone(await onLoginEmail(email, password))} />
        </>
      ) : (
        <form className="prompt-form" onSubmit={submit}>
          {returning && (
            <p className="modal-text">
              Players now log in with a four word passphrase. {name} already has one, from another device. Find it
              under Account there, and enter it here to keep your progress.
            </p>
          )}
          {mode === 'login' && (
            <p className="modal-text">Enter the four word passphrase you got when you first picked a name.</p>
          )}
          {mode === 'name' && <p className="modal-text">Pick a name to play with. Everyone in the jigsaw sees it.</p>}
          <div className="field-stack">
            <TextField
              key={mode}
              bad={!!error}
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setError('')
              }}
              onKeyDown={(e) => blocked && e.key === 'Enter' && e.preventDefault()}
              placeholder={login ? 'four word passphrase' : 'Name'}
              maxLength={login ? 200 : 32}
              autoCapitalize="none"
              autoComplete={login ? 'current-password' : 'nickname'}
              spellCheck={false}
              aria-label={login ? 'Passphrase' : 'Name'}
              title={login ? 'Passphrase' : 'Name'}
            />
            {error && <p className="modal-error">{error}</p>}
            {!login && !error && <PassphraseWarning value={value} />}
            <button className="primary wide" disabled={!value.trim() || busy} title={login ? 'Log in' : 'Continue'}>
              {busy ? <span className="spin" /> : login ? 'Log in' : 'Continue'}
              {!busy && <Arrow />}
            </button>
          </div>
          {returning && (
            <button type="button" className="link" onClick={fresh} disabled={busy}>
              Not you, or no other device? Start fresh as a new {name}
            </button>
          )}
        </form>
      )}
    </Dialog>
  )
}
