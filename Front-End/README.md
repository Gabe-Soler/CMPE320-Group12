# Front-End

Vite + React 19 (TypeScript) + Tailwind CSS v4.

## Setup

```bash
cd Front-End
npm install
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR at http://localhost:5173 |
| `npm run build` | Type-check (`tsc -b`) then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Lint with oxlint |

## Talking to the C++ back-end

`vite.config.ts` proxies `/api/*` to `http://localhost:8080`, so client code can
call the back-end with a relative path and no CORS configuration:

```ts
const res = await fetch('/api/health')
```

Change the `target` in `vite.config.ts` if the C++ server listens on a
different port.

## Tailwind

Tailwind v4 is wired through the `@tailwindcss/vite` plugin. There is no
`tailwind.config.js` — the single `@import "tailwindcss";` in `src/index.css`
is the whole setup, and theme customization goes in that file under `@theme`.
