import { useEffect, useState } from 'react'

type Health = { status: string; service: string }

type BackendState =
  | { kind: 'loading' }
  | { kind: 'ok'; health: Health }
  | { kind: 'error'; message: string }

function BackendStatus() {
  const [state, setState] = useState<BackendState>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`back-end responded ${res.status}`)
        return res.json() as Promise<Health>
      })
      .then((health) => setState({ kind: 'ok', health }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'unreachable',
        })
      })

    return () => controller.abort()
  }, [])

  const dot =
    state.kind === 'ok'
      ? 'bg-emerald-400'
      : state.kind === 'error'
        ? 'bg-rose-400'
        : 'bg-slate-500 animate-pulse'

  const label =
    state.kind === 'ok'
      ? `${state.health.service} — ${state.health.status}`
      : state.kind === 'error'
        ? `back-end unreachable (${state.message})`
        : 'checking back-end…'

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-300">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span>{label}</span>
    </div>
  )
}

function App() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
      <div className="max-w-xl text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">CMPE320 — Group 12</h1>
        <p className="text-slate-400">
          Vite + React + Tailwind front-end. The C++ back-end is served under{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-sm">/api</code>.
        </p>
        <BackendStatus />
        <div>
          <a
            className="inline-block rounded-lg bg-indigo-500 px-4 py-2 font-medium hover:bg-indigo-400 transition-colors"
            href="https://crowcpp.org/master/"
            target="_blank"
            rel="noreferrer"
          >
            Crow docs
          </a>
        </div>
      </div>
    </main>
  )
}

export default App
