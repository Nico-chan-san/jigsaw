import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import {
  Changelog as ChangelogIcon,
  External,
  Gear,
  GitHub,
  Help,
  Lock,
  Moon,
  Sound,
  User,
  Wrench,
} from './icons.jsx'
import Changelog from './Changelog.jsx'
import Dialog from './Dialog.jsx'
import AccountDialog from './AccountDialog.jsx'
import { useLinger } from '../lib/linger.js'
import PrivateRoom from './PrivateRoom.jsx'

// Header button that opens the settings dialog: account, dark mode, sounds, changelog and source link.
// In development (npm run dev) it also has the dev menu switch.
// In a private jigsaw it also has a button that shows its link.
// In a jigsaw it also has how to play (onHelp).
// Escape opens it when it has nothing else to do: no field being typed in, nothing open over the
// page, and nothing in escTaken (the jigsaw's selection and the like). The dialog closes on Escape.
export default function Settings({ privateRoom = false, onHelp, escTaken }) {
  const { theme, toggleTheme, sound, toggleSound, devMenu, toggleDevMenu, roomId } = useApp()
  const [sharing, setSharing] = useState(false)
  const closeSharing = useCallback(() => setSharing(false), [])
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const [shown, closing] = useLinger(open)
  const [account, setAccount] = useState(false)
  const closeAccount = useCallback(() => setAccount(false), [])
  const [accountShown, accountClosing] = useLinger(account)
  const [changelog, setChangelog] = useState(false)
  const closeChangelog = useCallback(() => setChangelog(false), [])
  const [changelogShown, changelogClosing] = useLinger(changelog)
  const dark = theme === 'dark'

  // In the capture phase, so it sees what is open or selected before other handlers clear it.
  useEffect(() => {
    const key = (e) => {
      if (e.key !== 'Escape' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return
      if (document.querySelector('.modal-bg, .context-menu, .players-menu:not(.closing), .podium, .react-pick [aria-pressed="true"]')) return
      if (escTaken?.()) return
      // The dialog starts listening for Escape while this press is still on its way, so it ends
      // here, or the dialog would close again at once.
      e.stopImmediatePropagation()
      setOpen(true)
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [escTaken])

  // Closes the dialog, then opens what the row is for.
  const then = (fn) => () => {
    setOpen(false)
    fn()
  }

  return (
    <span className="settings">
      <button
        className={`icon-btn${open ? ' on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-keyshortcuts="Escape"
        data-tip="Settings"
        data-key="Esc"
      >
        <Gear />
      </button>
      {shown && (
        <Dialog title="Settings" className="settings-dialog" bodyClass="settings-body" onClose={close} closing={closing}>
          <section className="settings-section" aria-labelledby="settings-account">
            <h2 className="label" id="settings-account">Account</h2>
            <button className="settings-row" onClick={then(() => setAccount(true))}>
              <User />
              <span>Your account</span>
            </button>
          </section>
          {(privateRoom || onHelp) && (
            <section className="settings-section" aria-labelledby="settings-jigsaw">
              <h2 className="label" id="settings-jigsaw">This jigsaw</h2>
              {privateRoom && (
                <button className="settings-row" onClick={then(() => setSharing(true))}>
                  <Lock />
                  <span>Private room</span>
                </button>
              )}
              {onHelp && (
                <button className="settings-row" aria-keyshortcuts="H" onClick={then(onHelp)}>
                  <Help />
                  <span>How to play</span>
                  <kbd className="settings-key">H</kbd>
                </button>
              )}
            </section>
          )}
          <section className="settings-section" aria-labelledby="settings-prefs">
            <h2 className="label" id="settings-prefs">Preferences</h2>
            <button className="settings-row" role="switch" aria-checked={dark} onClick={toggleTheme}>
              <Moon />
              <span>Dark mode</span>
              <span className={`switch${dark ? ' on' : ''}`} aria-hidden="true" />
            </button>
            <button className="settings-row" role="switch" aria-checked={sound} onClick={toggleSound}>
              <Sound />
              <span>Sounds</span>
              <span className={`switch${sound ? ' on' : ''}`} aria-hidden="true" />
            </button>
            {import.meta.env.DEV && (
              <button className="settings-row" role="switch" aria-checked={devMenu} onClick={toggleDevMenu}>
                <Wrench />
                <span>Dev menu</span>
                <span className={`switch${devMenu ? ' on' : ''}`} aria-hidden="true" />
              </button>
            )}
          </section>
          <section className="settings-section" aria-labelledby="settings-about">
            <h2 className="label" id="settings-about">About</h2>
            <button className="settings-row" onClick={then(() => setChangelog(true))}>
              <ChangelogIcon />
              <span>Changelog</span>
            </button>
            <a
              className="settings-row"
              href="https://github.com/mebn/jigsaw"
              title="Opens in a new tab"
              aria-label="Source on GitHub (opens in a new tab)"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitHub />
              <span>Source on GitHub</span>
              <External className="settings-ext" />
            </a>
          </section>
        </Dialog>
      )}
      {sharing && roomId && <PrivateRoom id={roomId} onClose={closeSharing} />}
      {accountShown && <AccountDialog onClose={closeAccount} closing={accountClosing} />}
      {changelogShown && <Changelog onClose={closeChangelog} closing={changelogClosing} />}
    </span>
  )
}
