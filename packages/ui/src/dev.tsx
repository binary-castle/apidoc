import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiReference } from './ApiReference'
import './styles.css'

/**
 * Dev host: renders the reference for ?spec=<url> (default: the Orbit example)
 * with a small switcher for the bundled example specs and the live Django app.
 */
const LIVE_DJANGO = [
  { label: 'Django · drf-spectacular (live)', url: 'http://localhost:8000/api/schema/' },
  { label: 'Django · drf-yasg (live)', url: 'http://localhost:8000/api/swagger.json' },
]

function SpecSwitcher({ current }: { current: string }) {
  const [files, setFiles] = useState<string[]>([])
  useEffect(() => {
    fetch('/specs/')
      .then(r => r.json())
      .then(setFiles)
      .catch(() => setFiles([]))
  }, [])
  const options = [...files.map(f => ({ label: f, url: `/specs/${f}` })), ...LIVE_DJANGO]
  return (
    <select
      value={current}
      onChange={e => {
        const url = new URL(window.location.href)
        url.searchParams.set('spec', e.target.value)
        url.hash = ''
        window.location.href = url.toString()
      }}
      style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 100, font: '12px ui-monospace, monospace', padding: '6px 8px', borderRadius: 8, opacity: 0.85 }}
    >
      {!options.some(o => o.url === current) && <option value={current}>{current}</option>}
      {options.map(o => <option key={o.url} value={o.url}>{o.label}</option>)}
    </select>
  )
}

const params = new URLSearchParams(window.location.search)
const spec = params.get('spec') ?? '/specs/orbit.yaml'
const theme = params.get('theme')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ height: '100vh' }}>
      <ApiReference spec={spec} theme={theme === 'light' || theme === 'dark' ? theme : undefined} />
    </div>
    <SpecSwitcher current={spec} />
  </StrictMode>,
)
