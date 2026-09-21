function App() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
      <div className="max-w-xl text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">CMPE320 — Group 12</h1>
        <p className="text-slate-400">
          Vite + React + Tailwind front-end. The C++ back-end is served under{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-sm">/api</code>.
        </p>
        <a
          className="inline-block rounded-lg bg-indigo-500 px-4 py-2 font-medium hover:bg-indigo-400 transition-colors"
          href="https://vite.dev"
          target="_blank"
          rel="noreferrer"
        >
          Vite docs
        </a>
      </div>
    </main>
  )
}

export default App
