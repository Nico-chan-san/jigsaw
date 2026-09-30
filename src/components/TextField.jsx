// Every text field in the app, so they all look and size alike. Takes an input's props, plus bad
// (marks it invalid) and compact (the smaller size, next to a small button).
export default function TextField({ bad = false, compact = false, className = '', ...props }) {
  const cls = ['text', bad && 'bad', compact && 'compact', className].filter(Boolean).join(' ')
  return <input className={cls} {...props} />
}
