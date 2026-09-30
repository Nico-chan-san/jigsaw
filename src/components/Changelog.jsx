import { Fragment, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Close } from './icons.jsx'
import text from '../../CHANGELOG.md?raw'

// Inline markdown: **bold**, `code` and [links](url).
function inline(s) {
  const out = []
  const re = /\*\*(.+?)\*\*|`(.+?)`|\[(.+?)\]\((.+?)\)/g
  let at = 0
  for (let m; (m = re.exec(s)); ) {
    if (m.index > at) out.push(s.slice(at, m.index))
    const k = out.length
    if (m[1]) out.push(<strong key={k}>{m[1]}</strong>)
    else if (m[2]) out.push(<code key={k}>{m[2]}</code>)
    else
      out.push(
        <a key={k} href={m[4]} target="_blank" rel="noopener noreferrer">
          {m[3]}
        </a>,
      )
    at = re.lastIndex
  }
  if (at < s.length) out.push(s.slice(at))
  return out
}

// The changelog as sections: a title (## heading), then its paragraphs and bullet lists. The file's
// own # heading is left out, since the dialog has a title.
function parse(md) {
  const sections = []
  let blocks = null
  let para = null
  let list = null
  for (const raw of md.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('## ')) {
      blocks = []
      sections.push({ title: line.slice(3), blocks })
      para = list = null
    } else if (!blocks || line.startsWith('# ')) continue
    else if (/^[-*] /.test(line)) {
      para = null
      if (!list) blocks.push((list = { list: [] }))
      list.list.push(line.slice(2))
    } else if (!line) para = list = null
    else if (list) list.list[list.list.length - 1] += ` ${line}`
    else if (para) para.text += ` ${line}`
    else blocks.push((para = { text: line }))
  }
  return sections
}

const SECTIONS = parse(text)

export default function Changelog({ onClose, closing }) {
  useEffect(() => {
    if (closing) return
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose, closing])

  // Rendered on the body: the settings panel it opens from would otherwise contain it.
  return createPortal(
    <div className={`modal-bg${closing ? ' closing' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal changelog" role="dialog" aria-label="Changelog">
        <div className="help-head">
          <h1>Changelog</h1>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <Close />
          </button>
        </div>
        <div className="changelog-body">
          {SECTIONS.map((s, i) => (
            <section key={i}>
              <h2 className="label">{s.title}</h2>
              {s.blocks.map((b, j) => (
                <Fragment key={j}>
                  {b.list ? (
                    <ul>
                      {b.list.map((item, k) => (
                        <li key={k}>{inline(item)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>{inline(b.text)}</p>
                  )}
                </Fragment>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
