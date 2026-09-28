import { useEffect } from 'react'
import { Back, Close } from './icons.jsx'

// A large dialog over the board, for the jigsaw list and the new jigsaw form.
// Without onClose it can't be dismissed (there is no jigsaw behind it to go back to).
export default function Sheet({ title, onBack, onClose, closing, right, children }) {
  useEffect(() => {
    if (!onClose || closing) return
    const key = (e) => e.key === 'Escape' && !e.target?.closest?.('input, textarea') && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose, closing])

  return (
    <div className={`modal-bg${closing ? ' closing' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal sheet" role="dialog" aria-label={title}>
        <div className="sheet-head">
          <div className="title">
            {onBack && (
              <button className="icon-btn" onClick={onBack} aria-label="Back" title="Back to all jigsaws">
                <Back />
              </button>
            )}
            <h1>{title}</h1>
          </div>
          <div className="right">
            {right}
            {onClose && (
              <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
                <Close />
              </button>
            )}
          </div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
