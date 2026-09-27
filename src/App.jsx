import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import RoomsPage from './pages/Rooms.jsx'
import NewRoom from './pages/NewRoom.jsx'
import Room from './pages/Room.jsx'
import { Arrow, Moon, Sun } from './components/icons.jsx'

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k, v) => {
    try {
      if (v == null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {}
  },
}
export { store }

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

export function navigate(path) {
  window.location.hash = path
}

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1))
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

const media = window.matchMedia('(prefers-color-scheme: dark)')

function useTheme() {
  const [choice, setChoice] = useState(() => store.get('theme'))
  const [system, setSystem] = useState(media.matches ? 'dark' : 'light')
  useEffect(() => {
    const on = () => setSystem(media.matches ? 'dark' : 'light')
    media.addEventListener('change', on)
    return () => media.removeEventListener('change', on)
  }, [])
  const theme = choice || system
  useEffect(() => {
    if (choice) document.documentElement.dataset.theme = choice
    else delete document.documentElement.dataset.theme
  }, [choice])
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    const value = next === system ? null : next
    store.set('theme', value)
    if (value) document.documentElement.dataset.theme = value
    else delete document.documentElement.dataset.theme
    setChoice(value)
  }
  return [theme, toggle]
}

export function ThemeButton() {
  const { theme, toggleTheme } = useApp()
  return (
    <button className="icon-btn" onClick={toggleTheme} aria-label="Theme"
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
      {theme === 'dark' ? <Sun /> : <Moon />}
    </button>
  )
}

// Modal asking for a name. Shown only when the player tries something that needs one.
function NamePrompt({ onDone, onCancel }) {
  const [value, setValue] = useState('')
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onCancel])
  const submit = (e) => {
    e.preventDefault()
    const v = value.trim()
    if (v) onDone(v.slice(0, 32))
  }
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal" onSubmit={submit}>
        <h1>Your name</h1>
        <div className="row">
          <input
            className="text"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Name"
            maxLength={32}
            aria-label="Name"
            title="Name"
          />
          <button className="primary" disabled={!value.trim()} title="Continue">
            Continue
            <Arrow />
          </button>
        </div>
      </form>
    </div>
  )
}

export default function App() {
  const hash = useHash()
  const [theme, toggleTheme] = useTheme()
  const [name, setNameState] = useState(() => store.get('name'))
  const nameRef = useRef(name)
  const [prompt, setPrompt] = useState(null)
  const setName = useCallback((v) => {
    store.set('name', v)
    nameRef.current = v
    setNameState(v)
  }, [])

  // Resolves with the player's name, asking for it first if needed (null if they cancel).
  const requireName = useCallback(() => {
    if (nameRef.current) return Promise.resolve(nameRef.current)
    return new Promise((resolve) =>
      setPrompt((p) => {
        p?.resolve(null)
        return { resolve }
      }),
    )
  }, [])

  // Synchronous check for event handlers: true if a name is set, otherwise opens the prompt.
  const ensureName = useCallback(() => {
    if (nameRef.current) return true
    requireName()
    return false
  }, [requireName])

  useEffect(() => {
    if (!hash) navigate(store.get('lastRoom') ? `/r/${store.get('lastRoom')}` : '/rooms')
  }, [hash])

  const ctx = { theme, toggleTheme, name, setName, requireName, ensureName }

  let page = null
  if (hash === '/new') page = <NewRoom />
  else if (hash.startsWith('/r/')) page = <Room key={hash} id={hash.slice(3)} />
  else if (hash) page = <RoomsPage />

  return (
    <Ctx.Provider value={ctx}>
      {page}
      {prompt && (
        <NamePrompt
          onDone={(v) => {
            setName(v)
            prompt.resolve(v)
            setPrompt(null)
          }}
          onCancel={() => {
            prompt.resolve(null)
            setPrompt(null)
          }}
        />
      )}
    </Ctx.Provider>
  )
}
