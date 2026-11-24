import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { GlobalWorkerOptions } from 'pdfjs-dist'

const require = createRequire(import.meta.url)
GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
).href
