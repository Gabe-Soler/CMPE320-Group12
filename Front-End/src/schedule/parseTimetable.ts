import {
  dedupeMeetings,
  extractTimeRange,
  formatClock,
  isComplete,
  isLikelyCourseMatch,
  newId,
  normalizeEntry,
  normalizeOcrNoise,
  parseClock,
  parseComponent,
  parseCourse,
  parseDate,
  parseWeekdays,
  type ExtractionWarning,
  type ParseResult,
  type PdfTextItem,
  type ScheduleEntry,
} from './time'

export type ClassRect = { x: number; y: number; w: number; h: number }

export type Raster = {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
  channels: number
}

export type GridColumn = { day: number; left: number; right: number; center: number }

export type TimetableGrid = {
  columns: GridColumn[]
  vLines: number[]
  hLines: number[]
}

export const CLASS_FILL = {
  nearWhite: 235,
  minGreen: 108,
  minChroma: 16,
  yellowDeltaB: 18,
  tealDeltaR: 8,
  minCoverage: 0.28,
  maxWhiteCoverage: 0.5,
  minInteriorHits: 2,
  minWidth: 28,
  minHeight: 20,
  gapPx: 8,
  rowGreen: 0.45,
  gridChroma: 40,
  gridMin: 70,
  gridMax: 230,
}

export function isNearWhite(r: number, g: number, b: number): boolean {
  return r > CLASS_FILL.nearWhite && g > CLASS_FILL.nearWhite && b > 220 && Math.max(r, g, b) - Math.min(r, g, b) < 32
}

export function isClassFill(r: number, g: number, b: number): boolean {
  if (isNearWhite(r, g, b)) return false
  const min = Math.min(r, g, b)
  const max = Math.max(r, g, b)
  if (max - min < CLASS_FILL.minChroma || g < CLASS_FILL.minGreen) return false
  const yellowGreen = g >= r - 8 && g - b >= CLASS_FILL.yellowDeltaB && r > 70
  const tealGreen = g > r + CLASS_FILL.tealDeltaR && g > b + 5 && g > 115
  return yellowGreen || tealGreen
}

function isGridStroke(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max - min < CLASS_FILL.gridChroma && min > CLASS_FILL.gridMin && max < CLASS_FILL.gridMax
}

function pixel(raster: Raster, x: number, y: number): [number, number, number] {
  const i = (y * raster.width + x) * raster.channels
  return [raster.data[i], raster.data[i + Math.min(1, raster.channels - 1)], raster.data[i + Math.min(2, raster.channels - 1)]]
}

export function classFillStats(raster: Raster, rect: ClassRect): { greenRatio: number; whiteRatio: number; samples: number; interiorHits: number } {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(raster.width, Math.ceil(rect.x + rect.w))
  const y1 = Math.min(raster.height, Math.ceil(rect.y + rect.h))
  let green = 0
  let white = 0
  let samples = 0
  const step = Math.max(1, Math.floor(Math.min(rect.w, rect.h) / 40))
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const [r, g, b] = pixel(raster, x, y)
      samples++
      if (isClassFill(r, g, b)) green++
      if (isNearWhite(r, g, b)) white++
    }
  }
  const points = [
    [0.3, 0.3],
    [0.5, 0.5],
    [0.7, 0.3],
    [0.3, 0.7],
    [0.7, 0.7],
  ]
  let interiorHits = 0
  for (const [fx, fy] of points) {
    const x = Math.min(raster.width - 1, Math.max(0, Math.floor(rect.x + rect.w * fx)))
    const y = Math.min(raster.height - 1, Math.max(0, Math.floor(rect.y + rect.h * fy)))
    const [r, g, b] = pixel(raster, x, y)
    if (isClassFill(r, g, b)) interiorHits++
  }
  return {
    greenRatio: samples ? green / samples : 0,
    whiteRatio: samples ? white / samples : 1,
    samples,
    interiorHits,
  }
}

export function isCredibleClassBlock(raster: Raster, rect: ClassRect): boolean {
  if (rect.w < CLASS_FILL.minWidth || rect.h < CLASS_FILL.minHeight) return false
  const stats = classFillStats(raster, rect)
  if (stats.whiteRatio > CLASS_FILL.maxWhiteCoverage) return false
  if (stats.greenRatio < CLASS_FILL.minCoverage) return false
  if (stats.interiorHits < CLASS_FILL.minInteriorHits) return false
  return true
}

export function rectIou(a: ClassRect, b: ClassRect): number {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

function peakPositions(score: number[], minScore: number, merge = 2): number[] {
  const hits: number[] = []
  for (let i = 0; i < score.length; i++) if (score[i] >= minScore) hits.push(i)
  if (!hits.length) return []
  const groups: { start: number; end: number }[] = [{ start: hits[0], end: hits[0] }]
  for (const pos of hits.slice(1)) {
    const last = groups[groups.length - 1]
    if (pos - last.end <= merge) last.end = pos
    else groups.push({ start: pos, end: pos })
  }
  return groups.map((group) => {
    let best = group.start
    for (let i = group.start; i <= group.end; i++) if (score[i] > score[best]) best = i
    return best
  })
}

export function detectTimetableGrid(raster: Raster): TimetableGrid | undefined {
  const vScore = new Array(raster.width).fill(0)
  const hScore = new Array(raster.height).fill(0)
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const [r, g, b] = pixel(raster, x, y)
      if (!isGridStroke(r, g, b)) continue
      vScore[x]++
      hScore[y]++
    }
  }
  const vLines = peakPositions(vScore, raster.height * 0.28, 2)
  const hLines = peakPositions(hScore, raster.width * 0.28, 2)
  if (vLines.length < 6) return undefined
  const gaps = []
  for (let i = 0; i < vLines.length - 1; i++) {
    const left = vLines[i] + 1
    const right = vLines[i + 1]
    const width = right - left
    if (width >= 36) gaps.push({ left, right, width, center: (left + right) / 2 })
  }
  if (gaps.length < 5) return undefined
  const dayLike = [...gaps].sort((a, b) => a.width - b.width)
  const median = dayLike[Math.floor(dayLike.length / 2)].width
  const days = gaps.filter((gap) => gap.width >= median * 0.72 && gap.width <= median * 1.35).slice(0, 7)
  if (days.length < 5) return undefined
  return {
    vLines,
    hLines,
    columns: days.map((gap, i) => ({
      day: i,
      left: gap.left,
      right: gap.right,
      center: gap.center,
    })),
  }
}

function isDarkInk(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) < 110 && !isClassFill(r, g, b) && !isNearWhite(r, g, b)
}

function typicalPitch(hLines: number[], fallback = 48): number {
  const diffs: number[] = []
  for (let i = 1; i < hLines.length; i++) {
    const delta = hLines[i] - hLines[i - 1]
    if (delta >= 12 && delta <= 96) diffs.push(delta)
  }
  if (!diffs.length) return fallback
  diffs.sort((a, b) => a - b)
  return diffs[Math.floor(diffs.length / 2)]
}

function inkClusters(raster: Raster, x0: number, x1: number, y0: number, y1: number): { start: number; end: number }[] {
  const width = Math.max(1, x1 - x0)
  const ink: number[] = []
  for (let y = y0; y < y1; y++) {
    let dark = 0
    for (let x = x0; x < x1; x++) {
      const [r, g, b] = pixel(raster, x, y)
      if (isDarkInk(r, g, b)) dark++
    }
    ink.push(dark / width)
  }
  const flags = ink.map((value) => value >= 0.035)
  return closeRuns(flags, 12, 4).map((run) => ({ start: y0 + run.start, end: y0 + run.end }))
}

function snapToLine(y: number, hLines: number[], window: number): number {
  let best = y
  let bestDist = window + 1
  for (const line of hLines) {
    const dist = Math.abs(line - y)
    if (dist < bestDist) {
      best = line
      bestDist = dist
    }
  }
  return bestDist <= window ? best : y
}

function splitOccupiedRun(
  raster: Raster,
  col: { left: number; right: number },
  run: { start: number; end: number },
  hLines: number[],
): { start: number; end: number }[] {
  const height = run.end - run.start
  const pitch = typicalPitch(hLines, Math.max(36, CLASS_FILL.minHeight * 2))
  if (height < pitch * 1.35) return [run]
  const inset = 2
  const x0 = col.left + inset
  const x1 = col.right - inset
  const clusters = inkClusters(raster, x0, x1, run.start, run.end).filter((cluster) => cluster.end - cluster.start >= 8)
  if (clusters.length < 2) return [run]
  const cuts = [run.start]
  for (let i = 0; i < clusters.length - 1; i++) {
    const upper = clusters[i]
    const lower = clusters[i + 1]
    const upperLooksLikeHeader = upper.end - upper.start >= 10
    const lowerLooksLikeHeader = lower.end - lower.start >= 10
    const lowerIsFooter = !lowerLooksLikeHeader && lower.start > run.start + height * 0.62
    if (!upperLooksLikeHeader || lowerIsFooter) continue
    const valleyLines = hLines.filter((line) => line >= upper.end - 2 && line <= lower.start + 2)
    const mid = Math.round((upper.end + lower.start) / 2)
    const splitY = valleyLines.length
      ? valleyLines.reduce((best, line) => (Math.abs(line - mid) < Math.abs(best - mid) ? line : best))
      : snapToLine(mid, hLines, Math.max(4, Math.round(pitch * 0.3)))
    const last = cuts[cuts.length - 1]
    if (splitY - last >= CLASS_FILL.minHeight && run.end - splitY >= CLASS_FILL.minHeight) cuts.push(splitY)
  }
  cuts.push(run.end)
  if (cuts.length === 2) return [run]
  const parts: { start: number; end: number }[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    if (cuts[i + 1] - cuts[i] >= CLASS_FILL.minHeight) parts.push({ start: cuts[i], end: cuts[i + 1] })
  }
  return parts.length ? parts : [run]
}

function closeRuns(flags: boolean[], gap: number, minLen: number): { start: number; end: number }[] {
  const closed = flags.slice()
  let hole = -1
  for (let i = 0; i <= closed.length; i++) {
    const on = i < closed.length && closed[i]
    if (!on && hole < 0) hole = i
    if ((on || i === closed.length) && hole >= 0) {
      if (i - hole <= gap && hole > 0 && i < closed.length) {
        for (let j = hole; j < i; j++) closed[j] = true
      }
      hole = -1
    }
  }
  const runs: { start: number; end: number }[] = []
  let start = -1
  for (let i = 0; i <= closed.length; i++) {
    const on = i < closed.length && closed[i]
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      if (i - start >= minLen) runs.push({ start, end: i })
      start = -1
    }
  }
  return runs
}

function classesInGridColumn(raster: Raster, col: GridColumn, hLines: number[]): ClassRect[] {
  const inset = 2
  const x0 = col.left + inset
  const x1 = col.right - inset
  const width = x1 - x0
  if (width < CLASS_FILL.minWidth) return []
  const occupied = new Array(raster.height).fill(false)
  for (let y = 0; y < raster.height; y++) {
    let green = 0
    let n = 0
    for (let x = x0; x < x1; x++) {
      const [r, g, b] = pixel(raster, x, y)
      n++
      if (isClassFill(r, g, b)) green++
    }
    occupied[y] = n > 0 && green / n >= CLASS_FILL.rowGreen
  }
  return closeRuns(occupied, CLASS_FILL.gapPx, CLASS_FILL.minHeight).flatMap((run) =>
    splitOccupiedRun(raster, col, run, hLines).map((part) => ({
      x: x0,
      y: part.start,
      w: width,
      h: part.end - part.start,
    })),
  )
}

function suppressOverlaps(raster: Raster, blocks: ClassRect[]): ClassRect[] {
  const ranked = [...blocks].sort((a, b) => classFillStats(raster, b).greenRatio - classFillStats(raster, a).greenRatio || b.w * b.h - a.w * a.h)
  const kept: ClassRect[] = []
  for (const block of ranked) {
    if (kept.some((other) => rectIou(block, other) >= 0.35)) continue
    kept.push(block)
  }
  kept.sort((a, b) => a.y - b.y || a.x - b.x)
  return kept
}

function buildMask(raster: Raster): Uint8Array {
  const { width, height } = raster
  const raw = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(raster, x, y)
      if (isClassFill(r, g, b)) raw[y * width + x] = 1
    }
  }
  const closed = new Uint8Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if (raw[i] || raw[i - 1] || raw[i + 1] || raw[i - width] || raw[i + width]) closed[i] = 1
    }
  }
  const eroded = new Uint8Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if (closed[i] && closed[i - 1] && closed[i + 1] && closed[i - width] && closed[i + width]) eroded[i] = 1
    }
  }
  return eroded
}

function smooth(values: number[], radius = 2): number[] {
  return values.map((_, i) => {
    let sum = 0
    let n = 0
    for (let j = i - radius; j <= i + radius; j++) {
      if (j < 0 || j >= values.length) continue
      sum += values[j]
      n++
    }
    return sum / n
  })
}

function runsAbove(profile: number[], minValue: number, minLen: number): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = []
  let start = -1
  for (let i = 0; i <= profile.length; i++) {
    const on = i < profile.length && profile[i] >= minValue
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      if (i - start >= minLen) runs.push({ start, end: i })
      start = -1
    }
  }
  return runs
}

function splitWideRun(run: { start: number; end: number }, profile: number[], pitch: number): { start: number; end: number }[] {
  const width = run.end - run.start
  if (width < pitch * 1.45) return [run]
  const slice = profile.slice(run.start, run.end)
  const peak = Math.max(...slice, 1)
  const cuts = [run.start]
  for (let x = run.start + Math.floor(pitch * 0.45); x < run.end - Math.floor(pitch * 0.45); x++) {
    if (profile[x] < peak * 0.35 && profile[x] <= profile[x - 1] && profile[x] <= profile[x + 1]) {
      if (x - cuts[cuts.length - 1] >= pitch * 0.6) cuts.push(x)
    }
  }
  cuts.push(run.end)
  if (cuts.length === 2) {
    const cols = Math.max(2, Math.round(width / pitch))
    const colW = width / cols
    return Array.from({ length: cols }, (_, i) => ({
      start: Math.round(run.start + i * colW),
      end: Math.round(run.start + (i + 1) * colW),
    }))
  }
  const out: { start: number; end: number }[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    if (cuts[i + 1] - cuts[i] >= 24) out.push({ start: cuts[i], end: cuts[i + 1] })
  }
  return out.length ? out : [run]
}

function columnBands(mask: Uint8Array, width: number, height: number): { left: number; right: number; center: number }[] {
  const axis = Math.floor(width * 0.11)
  const profile = new Array(width).fill(0)
  for (let x = axis; x < width; x++) {
    for (let y = 0; y < height; y++) if (mask[y * width + x]) profile[x]++
  }
  const smoothed = smooth(profile, 3)
  const peak = Math.max(...smoothed, 1)
  const rawRuns = runsAbove(smoothed, peak * 0.12, 24)
  const widths = rawRuns.map((run) => run.end - run.start).filter((w) => w >= 36 && w <= 130)
  const pitch = widths.length ? widths.sort((a, b) => a - b)[Math.floor(widths.length / 2)] : Math.max(48, width / 8)
  return rawRuns
    .flatMap((run) => splitWideRun(run, smoothed, pitch))
    .filter((run) => run.end - run.start >= 28)
    .map((run) => ({
      left: run.start,
      right: run.end,
      center: (run.start + run.end) / 2,
    }))
}

function shrinkToGreen(raster: Raster, rect: ClassRect): ClassRect | undefined {
  let minX = rect.x + rect.w
  let maxX = rect.x
  let minY = rect.y + rect.h
  let maxY = rect.y
  let hits = 0
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) continue
      const [r, g, b] = pixel(raster, x, y)
      if (!isClassFill(r, g, b)) continue
      hits++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (hits < 40) return undefined
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function splitOnWhiteGaps(
  raster: Raster,
  col: { left: number; right: number },
  run: { start: number; end: number },
): { start: number; end: number }[] {
  if (run.end - run.start < CLASS_FILL.minHeight * 2 + 6) return [run]
  const gaps: { start: number; end: number }[] = []
  let gapStart = -1
  for (let y = run.start; y < run.end; y++) {
    let green = 0
    let white = 0
    let n = 0
    for (let x = col.left; x < col.right; x++) {
      if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) continue
      const [r, g, b] = pixel(raster, x, y)
      n++
      if (isClassFill(r, g, b)) green++
      else if (isNearWhite(r, g, b)) white++
    }
    const isGap = n > 0 && white / n >= 0.42 && green / n <= 0.22
    if (isGap && gapStart < 0) gapStart = y
    if (!isGap && gapStart >= 0) {
      if (y - gapStart >= 3) gaps.push({ start: gapStart, end: y })
      gapStart = -1
    }
  }
  if (gapStart >= 0 && run.end - gapStart >= 3) gaps.push({ start: gapStart, end: run.end })
  if (!gaps.length) return [run]
  const parts: { start: number; end: number }[] = []
  let y = run.start
  for (const gap of gaps) {
    if (gap.start - y >= CLASS_FILL.minHeight) parts.push({ start: y, end: gap.start })
    y = gap.end
  }
  if (run.end - y >= CLASS_FILL.minHeight) parts.push({ start: y, end: run.end })
  return parts.length ? parts : [run]
}

function classesInColumn(raster: Raster, mask: Uint8Array, col: { left: number; right: number }): ClassRect[] {
  const { width, height } = raster
  const colW = col.right - col.left
  const density = new Array(height).fill(0)
  for (let y = 0; y < height; y++) {
    let n = 0
    for (let x = col.left; x < col.right; x++) if (mask[y * width + x]) n++
    density[y] = n / Math.max(1, colW)
  }
  const rawRuns = runsAbove(density, 0.18, CLASS_FILL.minHeight)
  const merged: { start: number; end: number }[] = []
  for (const run of rawRuns) {
    const last = merged[merged.length - 1]
    if (last && run.start - last.end <= CLASS_FILL.gapPx) last.end = run.end
    else merged.push({ ...run })
  }
  const out: ClassRect[] = []
  for (const run of merged.flatMap((item) => splitOnWhiteGaps(raster, col, item)).flatMap((item) => splitOccupiedRun(raster, col, item, []))) {
    const box = shrinkToGreen(raster, {
      x: col.left,
      y: run.start,
      w: colW,
      h: run.end - run.start,
    })
    if (!box) continue
    const clamped: ClassRect = {
      x: Math.max(col.left, box.x),
      y: box.y,
      w: Math.min(col.right, box.x + box.w) - Math.max(col.left, box.x),
      h: box.h,
    }
    if (isCredibleClassBlock(raster, clamped)) out.push(clamped)
  }
  return out
}

function fallbackGreenBlocks(raster: Raster): ClassRect[] {
  const mask = buildMask(raster)
  const cols = columnBands(mask, raster.width, raster.height)
  return cols.flatMap((col) => classesInColumn(raster, mask, col))
}

export function detectGreenClassBlocks(raster: Raster): ClassRect[] {
  const grid = detectTimetableGrid(raster)
  if (grid && grid.columns.length >= 5) {
    return suppressOverlaps(raster, grid.columns.flatMap((col) => classesInGridColumn(raster, col, grid.hLines)))
  }
  return suppressOverlaps(
    raster,
    fallbackGreenBlocks(raster).filter((block) => isCredibleClassBlock(raster, block)),
  )
}

export function columnBoundsFromBlocks(blocks: ClassRect[], pageWidth: number): GridColumn[] | undefined {
  if (blocks.length < 2) return undefined
  const widths = blocks.map((block) => block.w).sort((a, b) => a - b)
  const pitch = widths[Math.floor(widths.length / 2)] || 70
  const sorted = [...blocks].sort((a, b) => a.x - b.x)
  const groups: ClassRect[][] = []
  for (const block of sorted) {
    const last = groups[groups.length - 1]
    const lastX = last ? Math.min(...last.map((item) => item.x)) : Infinity
    if (!last || block.x - lastX > pitch * 0.55) groups.push([block])
    else last.push(block)
  }
  if (groups.length < 3 || groups.length > 7) return undefined
  const raw = groups.map((group, i) => {
    const left = Math.min(...group.map((block) => block.x))
    const right = Math.max(...group.map((block) => block.x + block.w))
    return { day: i, left, right, center: (left + right) / 2 }
  })
  return raw.map((col, i) => ({
    ...col,
    left: i === 0 ? Math.max(0, col.left - 4) : (raw[i - 1].center + col.center) / 2,
    right: i === raw.length - 1 ? Math.min(pageWidth, col.right + 4) : (col.center + raw[i + 1].center) / 2,
  }))
}

function joined(items: PdfTextItem[]): string {
  return [...items]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((i) => i.text.trim())
    .filter(Boolean)
    .join('\n')
}

function clusterValues(values: number[], gap: number): number[][] {
  const sorted = [...values].sort((a, b) => a - b)
  const groups: number[][] = []
  for (const value of sorted) {
    const last = groups[groups.length - 1]
    if (!last || value - last[last.length - 1] > gap) groups.push([value])
    else last.push(value)
  }
  return groups
}

function isColumnAnchor(text: string): boolean {
  if (parseCourse(text).courseCode) return true
  return /^(?!HALL|ROOM|AM|PM)[A-Z]{3,8}$/.test(text.trim())
}

function inferDayColumns(items: PdfTextItem[]): { day: number; left: number; right: number; center: number }[] | undefined {
  const courseXs = items.filter((item) => isColumnAnchor(item.text)).map((item) => item.x)
  if (courseXs.length < 3) return undefined
  const clusters = clusterValues(courseXs, 40)
  if (clusters.length < 4 || clusters.length > 7) return undefined
  const centers = clusters.map((cluster) => cluster.reduce((sum, x) => sum + x, 0) / cluster.length)
  return centers.map((center, i) => {
    const left = i === 0 ? center - 45 : (centers[i - 1] + center) / 2
    const right = i === centers.length - 1 ? center + 90 : (center + centers[i + 1]) / 2
    return { day: i, left, right, center }
  })
}

function cluster(items: PdfTextItem[], maxDx = 70, maxDy = 22): PdfTextItem[][] {
  const remaining = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const groups: PdfTextItem[][] = []
  for (const item of remaining) {
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < groups.length; i++) {
      const xs = groups[i].map((g) => g.x)
      const ys = groups[i].map((g) => g.y)
      const dx = Math.min(...xs.map((x) => Math.abs(item.x - x)))
      const above = item.y - Math.max(...ys)
      const below = Math.min(...ys) - item.y
      const attached = dx <= maxDx && above <= maxDy && below <= maxDy
      if (attached && dx + Math.max(0, above, below) < bestDist) {
        best = i
        bestDist = dx + Math.max(0, above, below)
      }
    }
    if (best >= 0) groups[best].push(item)
    else groups.push([item])
  }
  return groups
}

function clusterVertically(items: PdfTextItem[], maxDy = 40): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const groups: PdfTextItem[][] = []
  for (const item of sorted) {
    const last = groups[groups.length - 1]
    if (last && item.y - Math.max(...last.map((entry) => entry.y)) <= maxDy) last.push(item)
    else groups.push([item])
  }
  return groups
}

function itemColumnX(item: PdfTextItem): number {
  return item.x
}

function parseBlockText(
  text: string,
  days: number[],
  date: string | undefined,
  extra: ExtractionWarning[],
  source: ScheduleEntry['source'] = 'pdf',
  cropDataUrl?: string,
): ScheduleEntry {
  text = normalizeOcrNoise(text.replace(/[–—]/g, '-'))
  const { courseCode, section } = parseCourse(text)
  const component = parseComponent(text)
  const range = extractTimeRange(text)
  const warnings: ExtractionWarning[] = [...extra]
  let startTime = ''
  let endTime = ''

  if (range.start?.ok) startTime = formatClock(range.start.minute)
  else if (range.start && !range.start.ok) warnings.push(range.start.reason === 'ambiguous' ? 'ambiguous-ampm' : 'missing-start')
  else warnings.push('missing-start')

  if (range.end?.ok) endTime = formatClock(range.end.minute)
  else if (range.end && !range.end.ok) warnings.push(range.end.reason === 'ambiguous' ? 'ambiguous-ampm' : 'missing-end')
  else warnings.push('missing-end')

  if (!days.length) warnings.push('missing-day')

  const stripped = text
    .split('\n')
    .map((line) => {
      COURSE_LINE.lastIndex = 0
      return line
        .replace(COURSE_LINE, '')
        .replace(/\b(?!HALL|ROOM|DUNNING|KINGSTON|GOODES|JEFFERY|JEFFREY|ELLIS|GOODWIN|COMPLEX|CENTRE|CHERNOFF|AUD)[A-Z]{2,8}\s+\d{2,4}[A-Z]?\b/gi, '')
        .replace(/\b(lecture|laboratory|tutorial|seminar|lab|lec|tut|sem|lectura)\b/gi, '')
        .replace(/\b(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|mwf|tr)\b/gi, '')
        .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, '')
        .replace(/\b\d{1,2}\s*(am|pm)\b/gi, '')
        .replace(/\b0\d{2}\b/g, '')
        .replace(/:\d{2}/g, '')
        .replace(/[-–—]/g, ' ')
        .trim()
    })
    .filter((line) => line.length > 1 && !/^section\b/i.test(line))
  const location = stripped.join(' ').replace(/\s+/g, ' ').trim() || undefined
  if (!location) warnings.push('missing-location')

  const title = courseCode
    ? component
      ? `${courseCode} · ${component}`
      : courseCode
    : 'Unknown class'
  return normalizeEntry({
    id: newId(),
    title,
    courseCode,
    section,
    component,
    days,
    startTime,
    endTime,
    location,
    startDate: date,
    endDate: date,
    repeatsWeekly: false,
    source,
    warnings,
    confidence: 'high',
    cropDataUrl,
  })
}

const COURSE_LINE =
  /\b(?!HALL|ROOM|BLDG|BUILDING|LIBRARY|DUNNING|KINGSTON|GOODES|JEFFERY|JEFFREY|ELLIS|GOODWIN|STIRLING|DUPUIS|WALTER|COMPLEX|CENTRE|CENTER|AUDITORIUM|THEATRE|THEATER|BIOSCIENCES|CAMPUS|CHERNOFF|AUD)[A-Z]{2,8}\s+\d{2,4}[A-Z]?(?:\s*[-–]\s*\d{2,4})?\b/gi

function isCourseStart(text: string): boolean {
  COURSE_LINE.lastIndex = 0
  if (COURSE_LINE.test(text) || parseCourse(text).courseCode) return true
  return /^(?!HALL|ROOM|AM|PM)[A-Z]{3,8}$/.test(text.trim())
}

function splitOnCourseHeaders(group: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...group].sort((a, b) => a.y - b.y || a.x - b.x)
  const blocks: PdfTextItem[][] = []
  let current: PdfTextItem[] = []
  for (const item of sorted) {
    if (isCourseStart(item.text) && current.some((entry) => isCourseStart(entry.text))) {
      blocks.push(current)
      current = [item]
    } else current.push(item)
  }
  if (current.length) blocks.push(current)
  return blocks
}

function isWeekdayHeader(text: string): number | undefined {
  const days = parseWeekdays(text)
  return days.length === 1 ? days[0] : undefined
}

function queensGrid(items: PdfTextItem[]): ParseResult | undefined {
  const byPage = new Map<number, PdfTextItem[]>()
  for (const item of items) {
    const list = byPage.get(item.page) ?? []
    list.push(item)
    byPage.set(item.page, list)
  }

  const allEntries: ScheduleEntry[] = []
  const warnings: string[] = []
  let matched = false

  for (const pageItems of byPage.values()) {
    const headers = pageItems
      .map((item) => ({ item, day: isWeekdayHeader(item.text) }))
      .filter((h): h is { item: PdfTextItem; day: number } => h.day !== undefined)
      .sort((a, b) => a.item.x - b.item.x)

    const uniqueDays = [...new Map(headers.map((h) => [h.day, h])).values()].sort((a, b) => a.item.x - b.item.x)
    const inferred = uniqueDays.length >= 5 ? undefined : inferDayColumns(pageItems)
    if (uniqueDays.length < 5 && !inferred) continue
    matched = true

    const headerY = uniqueDays.length
      ? Math.min(...uniqueDays.map((h) => h.item.y))
      : Math.min(...pageItems.filter((item) => parseCourse(item.text).courseCode).map((item) => item.y), 40)
    const bounds =
      inferred ??
      uniqueDays.map((header, i, list) => {
        const x = header.item.x
        const left = i === 0 ? x - 40 : (list[i - 1].item.x + x) / 2
        const right = i === list.length - 1 ? x + 80 : (x + list[i + 1].item.x) / 2
        return { day: header.day, left, right, center: x }
      })

    const dateByDay = new Map<number, string>()
    for (const col of bounds) {
      const nearby = pageItems.filter(
        (item) => item.x >= col.left && item.x < col.right && Math.abs(item.y - headerY) < 48,
      )
      for (const item of nearby) {
        const date = parseDate(item.text)
        if (date) dateByDay.set(col.day, date)
      }
      const headerText = uniqueDays.find((u) => u.day === col.day)?.item.text ?? ''
      const headerDate = parseDate(headerText)
      if (headerDate) dateByDay.set(col.day, headerDate)
    }

    const headerIds = new Set(uniqueDays.map((h) => h.item))
    const leftover = pageItems.filter((item) => {
      if (headerIds.has(item)) return false
      if (uniqueDays.length && item.y < headerY - 8) return false
      if (isWeekdayHeader(item.text) !== undefined) return false
      if (parseDate(item.text) && item.y <= headerY + 24) return false
      const leftEdge = bounds[0].left
      if (item.x < leftEdge - 10 && (parseClock(item.text).ok || /^\d{1,2}:\d{2}/.test(item.text))) return false
      return item.text.trim().length > 0
    })

    const columnGap = bounds.length > 1 ? Math.min(...bounds.slice(1).map((col, i) => col.center - bounds[i].center)) : 90
    const blocks = bounds.length
      ? bounds.flatMap((col) => {
          const colItems = leftover.filter((item) => {
            const x = itemColumnX(item)
            return x >= col.left && x < col.right
          })
          return clusterVertically(colItems, Math.max(28, columnGap * 0.45)).flatMap(splitOnCourseHeaders)
        })
      : cluster(leftover, 90, 28).flatMap(splitOnCourseHeaders)
    for (const block of blocks) {
      const cx = block.reduce((s, i) => s + itemColumnX(i), 0) / block.length
      const col = bounds.find((b) => cx >= b.left && cx < b.right)
      const extra: ExtractionWarning[] = col ? [] : ['uncertain-grid', 'missing-day']
      const days = col ? [col.day] : []
      const date = col ? dateByDay.get(col.day) : undefined
      const text = joined(block)
      COURSE_LINE.lastIndex = 0
      if (!parseCourse(text).courseCode) {
        const range = extractTimeRange(text)
        if (!range.start && !range.end) continue
      }
      allEntries.push(parseBlockText(text, days, date, extra))
    }
  }

  if (!matched) return undefined
  if (!allEntries.length) warnings.push('The weekly grid was found, but no class blocks could be read.')
  return { entries: dedupeMeetings(allEntries), layout: 'queens-week', warnings }
}

function tableLayout(items: PdfTextItem[]): ParseResult | undefined {
  const rows = new Map<string, PdfTextItem[]>()
  for (const item of items) {
    const key = `${item.page}:${Math.round(item.y / 8)}`
    const list = rows.get(key) ?? []
    list.push(item)
    rows.set(key, list)
  }

  const parsed: ScheduleEntry[] = []
  let hits = 0
  for (const row of rows.values()) {
    const text = [...row]
      .sort((a, b) => a.x - b.x)
      .map((i) => i.text)
      .join(' ')
    const days = parseWeekdays(text)
    const course = parseCourse(text)
    const times = extractTimeRange(text)
    if (!course.courseCode && days.length === 0) continue
    if (!times.start && days.length === 0) continue
    hits++
    parsed.push(
      parseBlockText(text, days, parseDate(text), days.length ? [] : ['missing-day']),
    )
  }

  if (hits < 1) return undefined
  return { entries: dedupeMeetings(parsed), layout: 'table', warnings: [] }
}

function linearLayout(items: PdfTextItem[]): ParseResult {
  const text = [...items]
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
    .map((i) => i.text)
    .join('\n')

  const chunks = text.split(/\n{2,}/)
  const entries: ScheduleEntry[] = []
  const scan = chunks.length > 1 ? chunks : text.split(/\n/)
  for (const chunk of scan) {
    const course = parseCourse(chunk)
    const days = parseWeekdays(chunk)
    const times = extractTimeRange(chunk)
    if (!course.courseCode && days.length === 0) continue
    if (!times.start && !times.end && days.length === 0) continue
    entries.push(parseBlockText(chunk, days, parseDate(chunk), []))
  }

  if (!entries.length) {
    return {
      entries: [],
      layout: 'unknown',
      warnings: ['No recognizable class meetings were found. You can add classes manually.'],
    }
  }
  return { entries: dedupeMeetings(entries), layout: 'linear', warnings: [] }
}

function snap30(minute: number): number {
  return Math.max(0, Math.min(24 * 60 - 30, Math.round(minute / 30) * 30))
}

function minuteAtFactory(points: { y: number; minute: number }[]): ((y: number) => number) | undefined {
  if (points.length < 2) return undefined
  const sorted = [...points].sort((a, b) => a.y - b.y)
  const n = sorted.length
  const meanY = sorted.reduce((sum, point) => sum + point.y, 0) / n
  const meanM = sorted.reduce((sum, point) => sum + point.minute, 0) / n
  let num = 0
  let den = 0
  for (const point of sorted) {
    num += (point.y - meanY) * (point.minute - meanM)
    den += (point.y - meanY) ** 2
  }
  if (den < 1) return undefined
  const slope = num / den
  if (slope <= 0) return undefined
  const intercept = meanM - slope * meanY
  return (y) => slope * y + intercept
}

export function splitRectsByCourseHeaders(rect: ClassRect, items: PdfTextItem[]): ClassRect[] {
  const inside = items.filter(
    (item) =>
      item.x >= rect.x - 4 &&
      item.x <= rect.x + rect.w + 4 &&
      item.y >= rect.y - 4 &&
      item.y <= rect.y + rect.h + 4,
  )
  const headers = clusterVertically(inside, 8)
    .map((line) => ({ y: Math.min(...line.map((item) => item.y)), parsed: parseCourse(joined(line)) }))
    .filter((line) => line.parsed.courseCode)
  if (headers.length < 2) return [rect]
  return headers.map((header, i) => {
    const y0 = i === 0 ? rect.y : Math.round((headers[i - 1].y + header.y) / 2)
    const y1 = i + 1 < headers.length ? Math.round((header.y + headers[i + 1].y) / 2) : rect.y + rect.h
    return { ...rect, y: y0, h: Math.max(16, y1 - y0) }
  })
}

export function entriesFromClassBlocks(opts: {
  blocks: { rect: ClassRect; text: string; cropDataUrl?: string }[]
  items: PdfTextItem[]
  pageWidth: number
  pageHeight: number
  pageNumber?: number
  columns?: GridColumn[]
}): {
  entries: ScheduleEntry[]
  weekdayHeaders: number
  complete: number
  incomplete: number
  rejections: string[]
} {
  void opts.pageHeight
  void opts.pageNumber
  const rejections: string[] = []
  const headers = opts.items
    .map((item) => ({ item, day: isWeekdayHeader(item.text) }))
    .filter((h): h is { item: PdfTextItem; day: number } => h.day !== undefined)
  const uniqueDays = [...new Map(headers.map((h) => [h.day, h])).values()].sort((a, b) => a.item.x - b.item.x)
  const fromBlocks = columnBoundsFromBlocks(
    opts.blocks.map((block) => block.rect),
    opts.pageWidth,
  )
  const gridColumns = opts.columns && opts.columns.length >= 5 ? opts.columns : undefined
  const bounds =
    gridColumns ??
    (fromBlocks && fromBlocks.length >= 4
      ? uniqueDays.length === fromBlocks.length
        ? fromBlocks.map((col, i) => {
            const header = uniqueDays[i]
            return { ...col, day: header?.day ?? i }
          })
        : fromBlocks
      : uniqueDays.length >= 3
        ? uniqueDays.map((header, i, list) => {
            const x = header.item.x
            const left = i === 0 ? x - 40 : (list[i - 1].item.x + x) / 2
            const right = i === list.length - 1 ? x + 90 : (x + list[i + 1].item.x) / 2
            return { day: header.day, left, right, center: x }
          })
        : fromBlocks)

  const dateByDay = new Map<number, string>()
  if (bounds) {
    for (const col of bounds) {
      for (const item of opts.items) {
        if (item.x < col.left || item.x >= col.right) continue
        const date = parseDate(item.text)
        if (date) dateByDay.set(col.day, date)
      }
    }
  }

  const leftEdge = bounds?.[0]?.left ?? opts.pageWidth * 0.12
  const timePoints: { y: number; minute: number }[] = []
  for (const item of opts.items) {
    if (item.x > leftEdge - 4) continue
    if (!/[:h]|am|pm/i.test(item.text)) continue
    const clock = parseClock(item.text)
    if (clock.ok) timePoints.push({ y: item.y, minute: clock.minute })
  }
  const plausibleTimes = timePoints.filter((point) => point.minute >= 6 * 60 && point.minute <= 22 * 60)
  const minuteAt =
    plausibleTimes.length >= 3 && plausibleTimes.some((point) => point.minute >= 8 * 60)
      ? minuteAtFactory(plausibleTimes)
      : undefined
  const entries: ScheduleEntry[] = []

  function headerSplits(block: { rect: ClassRect; text: string }): { rect: ClassRect; text: string; weak?: boolean }[] {
    const inside = opts.items.filter(
      (item) =>
        item.x >= block.rect.x - 4 &&
        item.x <= block.rect.x + block.rect.w + 4 &&
        item.y >= block.rect.y - 4 &&
        item.y <= block.rect.y + block.rect.h + 4,
    )
    const lines = clusterVertically(inside, 8)
    const headers = lines
      .map((line) => ({ y: Math.min(...line.map((item) => item.y)), parsed: parseCourse(joined(line)) }))
      .filter((line) => line.parsed.courseCode)
    if (headers.length >= 2) {
      return headers.map((header, i) => {
        const y0 = i === 0 ? block.rect.y : Math.round((headers[i - 1].y + header.y) / 2)
        const y1 = i + 1 < headers.length ? Math.round((header.y + headers[i + 1].y) / 2) : block.rect.y + block.rect.h
        const slice = inside.filter((item) => item.y >= y0 && item.y < y1)
        return {
          rect: { ...block.rect, y: y0, h: Math.max(CLASS_FILL_MIN, y1 - y0) },
          text: joined(slice) || block.text,
        }
      })
    }
    const matcher = new RegExp(COURSE_LINE.source, 'gi')
    const matches = [...block.text.matchAll(matcher)].filter((match) => {
      const parsed = parseCourse(match[0])
      const dept = parsed.courseCode?.split(' ')[0]
      const number = parsed.courseCode?.split(' ')[1] ?? ''
      return Boolean(parsed.courseCode) && dept && isLikelyCourseMatch(dept, number)
    })
    if (matches.length < 2) return [{ rect: block.rect, text: block.text }]
    return matches.map((match, i) => {
      const start = match.index ?? 0
      const end = i + 1 < matches.length ? (matches[i + 1].index ?? block.text.length) : block.text.length
      const sliceH = block.rect.h / matches.length
      return {
        rect: { ...block.rect, y: block.rect.y + i * sliceH, h: sliceH },
        text: block.text.slice(start, end).trim(),
        weak: true,
      }
    })
  }

  const CLASS_FILL_MIN = 16

  for (const [index, block] of opts.blocks.entries()) {
    const cx = block.rect.x + block.rect.w / 2
    const col = bounds
      ? bounds.reduce((best, candidate) =>
          Math.abs(candidate.center - cx) < Math.abs(best.center - cx) ? candidate : best,
        )
      : undefined
    const extra: ExtractionWarning[] = col ? [] : ['uncertain-grid']
    const days = col ? [col.day] : []
    const date = col ? dateByDay.get(col.day) : undefined
    const chunks = headerSplits(block)
    if (chunks.length === 1) {
      const codes = [...block.text.matchAll(new RegExp(COURSE_LINE.source, 'gi'))].filter((match) => parseCourse(match[0]).courseCode)
      if (codes.length >= 2) extra.push('possible-merge')
    }
    for (const chunk of chunks) {
      const rect = chunk.rect
      const flags: ExtractionWarning[] = [...extra]
      if (chunk.weak) flags.push('possible-merge')
      let entry = parseBlockText(chunk.text, days, date, flags, 'pdf', block.cropDataUrl)

      if (minuteAt) {
        const gridStart = snap30(minuteAt(rect.y))
        const gridEnd = snap30(minuteAt(rect.y + rect.h))
        if (gridEnd > gridStart) {
          const ocrStart = entry.startTime ? parseClock(entry.startTime) : { ok: false as const, reason: 'invalid' as const }
          const ocrEnd = entry.endTime ? parseClock(entry.endTime) : { ok: false as const, reason: 'invalid' as const }
          if (ocrStart.ok && Math.abs(ocrStart.minute - gridStart) > 25) flags.push('ocr-mismatch')
          if (ocrEnd.ok && Math.abs(ocrEnd.minute - gridEnd) > 25) flags.push('ocr-mismatch')
          if (!ocrStart.ok) {
            entry = { ...entry, startTime: formatClock(gridStart), warnings: [...entry.warnings.filter((w) => w !== 'missing-start'), 'grid-time'] }
          }
          if (!ocrEnd.ok || (ocrStart.ok && ocrEnd.ok && ocrEnd.minute <= ocrStart.minute)) {
            entry = { ...entry, endTime: formatClock(gridEnd), warnings: [...entry.warnings.filter((w) => w !== 'missing-end' && w !== 'incomplete'), 'grid-time'] }
          }
          entry = normalizeEntry({ ...entry, warnings: [...new Set([...entry.warnings, ...flags])] })
        }
      }

      if (!entry.days.length && !entry.startTime && !chunk.text.trim()) {
        rejections.push(`Block ${index + 1}: empty OCR and no column/time calibration.`)
        continue
      }
      entries.push(entry)
    }
  }

  const complete = entries.filter((entry) => isComplete(entry)).length
  return {
    entries: dedupeMeetings(entries),
    weekdayHeaders: uniqueDays.length,
    complete,
    incomplete: entries.length - complete,
    rejections,
  }
}

export function parseTimetable(items: PdfTextItem[]): ParseResult {
  if (!items.some((i) => i.text.trim())) {
    return {
      entries: [],
      layout: 'unknown',
      warnings: ['No readable timetable text was found after PDF extraction and OCR. Add classes manually instead.'],
    }
  }

  const queens = queensGrid(items)
  if (queens && queens.entries.length) return queens
  const table = tableLayout(items)
  if (table && table.entries.length) return table
  if (queens) return queens
  return linearLayout(items)
}

export type OcrProgress = {
  message: string
  progress?: number
}

export type OcrWord = {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  confidence?: number
}

export type OcrDebug = {
  hasEmbeddedImage: boolean
  rasterWidth: number
  rasterHeight: number
  tesseractOk: boolean
  wordCount: number
  sampleText: string
  boxesOk: boolean
  weekdayHeaders: number
  classBlocks: number
  courseCodes: number
  complete: number
  incomplete: number
  rejections: string[]
  error?: string
}

export type OcrPageResult = {
  items: PdfTextItem[]
  entries: ScheduleEntry[]
  debug: OcrDebug
}

type PdfjsModule = typeof import('pdfjs-dist')
type PdfImage = { width?: number; height?: number; data?: Uint8Array | Uint8ClampedArray }
type PdfPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number; transform?: number[] }
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>
  objs: { get: (name: string, callback?: (data: unknown) => void) => unknown }
  render: (opts: Record<string, unknown>) => { promise: Promise<void> }
}

type TesseractWorker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>
type PsmEnum = (typeof import('tesseract.js'))['PSM']

let workerPromise: Promise<TesseractWorker> | undefined
let workerRef: TesseractWorker | undefined
let psm: PsmEnum | undefined

const MAX_CANVAS = 2800

export function ocrWordsToItems(words: OcrWord[], page: number, scale = 1): PdfTextItem[] {
  const safeScale = scale > 0 ? scale : 1
  const items: PdfTextItem[] = []
  for (const word of words) {
    const text = normalizeOcrNoise(word.text).trim()
    if (!text || text === '-' || text === '—') continue
    items.push({
      text,
      page,
      x: word.x0 / safeScale,
      y: word.y0 / safeScale,
      width: Math.max(1, (word.x1 - word.x0) / safeScale),
      height: Math.max(1, (word.y1 - word.y0) / safeScale),
    })
  }
  return items
}

export function pageNeedsOcr(items: PdfTextItem[]): boolean {
  const text = items.map((item) => item.text.trim()).filter(Boolean).join(' ')
  const hasCourse = /\b[A-Z]{2,8}\s+\d{2,4}\b/i.test(text)
  const hasDay = /\b(mon|tue|wed|thu|fri)/i.test(text)
  if (hasCourse || hasDay) return false
  return text.length < 24 || items.length < 6
}

function progressMessage(status: string, fraction?: number): string {
  const pct = fraction !== undefined ? ` ${Math.round(fraction * 100)}%` : ''
  if (/recogni/i.test(status)) return `Reading timetable image with OCR${pct}`
  if (/load/i.test(status)) return `Loading OCR engine${pct}`
  if (/init/i.test(status)) return `Starting OCR${pct}`
  return status + pct
}

async function createEngine(onProgress?: (update: OcrProgress) => void): Promise<TesseractWorker> {
  const mod = await import('tesseract.js')
  psm = mod.PSM
  const logger = (message: { status?: string; progress?: number }) => {
    onProgress?.({
      message: progressMessage(message.status ?? 'OCR', message.progress),
      progress: message.progress,
    })
  }

  return mod.createWorker('eng', 1, { logger, gzip: true })
}

export async function getOcrWorker(onProgress?: (update: OcrProgress) => void): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createEngine(onProgress).then((worker) => {
      workerRef = worker
      return worker.setParameters({
        user_defined_dpi: '300',
        preserve_interword_spaces: '1',
      }).then(() => worker)
    })
  }
  return workerPromise
}

export async function terminateOcrWorker(): Promise<void> {
  const worker = workerRef
  workerPromise = undefined
  workerRef = undefined
  if (worker) await worker.terminate()
}

function pickScale(width: number, height: number): number {
  const longest = Math.max(width, height)
  if (longest <= 700) return 3
  if (longest <= 1200) return 2
  return 1
}

function contrastGray(r: number, g: number, b: number, amount = 1.15): number {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b
  return Math.max(0, Math.min(255, (gray - 128) * amount + 128))
}

function colorCanvasFromRgb(rgb: Uint8Array, width: number, height: number, channels: number): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  const image = ctx.createImageData(width, height)
  for (let i = 0, p = 0; i < rgb.length && p < image.data.length; i += channels, p += 4) {
    image.data[p] = rgb[i]
    image.data[p + 1] = rgb[i + Math.min(1, channels - 1)]
    image.data[p + 2] = rgb[i + Math.min(2, channels - 1)]
    image.data[p + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

function mildGrayCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return source
  ctx.drawImage(source, 0, 0)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < image.data.length; i += 4) {
    const v = contrastGray(image.data[i], image.data[i + 1], image.data[i + 2], 1.12)
    image.data[i] = v
    image.data[i + 1] = v
    image.data[i + 2] = v
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

function encodeBmp(rgb: Uint8Array, width: number, height: number, channels: number, scale: number): Uint8Array {
  const outW = width * scale
  const outH = height * scale
  const stride = (outW * 3 + 3) & ~3
  const pixelBytes = stride * outH
  const header = 54
  const buffer = new Uint8Array(header + pixelBytes)
  const view = new DataView(buffer.buffer)
  view.setUint16(0, 0x4d42, true)
  view.setUint32(2, buffer.length, true)
  view.setUint32(10, header, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, outW, true)
  view.setInt32(22, outH, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, pixelBytes, true)
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale))
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale))
      const si = (sy * width + sx) * channels
      const v = contrastGray(rgb[si], rgb[si + Math.min(1, channels - 1)], rgb[si + Math.min(2, channels - 1)], 1.12)
      const di = header + (outH - 1 - y) * stride + x * 3
      buffer[di] = v
      buffer[di + 1] = v
      buffer[di + 2] = v
    }
  }
  return buffer
}

function paintOps(lib: PdfjsModule): Set<number> {
  return new Set(
    [lib.OPS.paintImageXObject, lib.OPS.paintInlineImageXObject, lib.OPS.paintImageXObjectRepeat, lib.OPS.paintXObject].filter(
      (value): value is number => typeof value === 'number',
    ),
  )
}

export async function pageHasRasterContent(page: PdfPage, lib: PdfjsModule): Promise<boolean> {
  const ops = await page.getOperatorList()
  const paint = paintOps(lib)
  return ops.fnArray.some((fn) => paint.has(fn))
}

async function readPdfObject(objs: PdfPage['objs'], name: string): Promise<PdfImage | undefined> {
  try {
    const value = objs.get(name)
    if (value && typeof (value as Promise<unknown>).then === 'function') {
      return (await value) as PdfImage | undefined
    }
    if (value) return value as PdfImage
  } catch {
    // pending
  }
  return await new Promise((resolve) => {
    try {
      objs.get(name, (data) => resolve((data ?? undefined) as PdfImage | undefined))
    } catch {
      resolve(undefined)
    }
  })
}

export async function extractEmbeddedImage(
  page: PdfPage,
  lib: PdfjsModule,
): Promise<Raster | undefined> {
  const ops = await page.getOperatorList()
  const paint = paintOps(lib)
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (!paint.has(ops.fnArray[i])) continue
    const name = ops.argsArray[i]?.[0]
    if (typeof name !== 'string') continue
    const image = await readPdfObject(page.objs, name)
    if (!image?.data || !image.width || !image.height) continue
    const data = image.data instanceof Uint8Array ? image.data : new Uint8Array(image.data)
    const channels = Math.max(1, Math.round(data.length / (image.width * image.height)))
    return { width: image.width, height: image.height, data, channels }
  }
  return undefined
}

async function rasterizeCanvas(page: PdfPage, scale: number): Promise<HTMLCanvasElement | undefined> {
  if (typeof document === 'undefined') return undefined
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  try {
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    return canvas
  } catch {
    return undefined
  }
}

function canvasToRaster(canvas: HTMLCanvasElement): Raster {
  const ctx = canvas.getContext('2d')
  const image = ctx?.getImageData(0, 0, canvas.width, canvas.height)
  return {
    data: image?.data ?? new Uint8ClampedArray(canvas.width * canvas.height * 4),
    width: canvas.width,
    height: canvas.height,
    channels: 4,
  }
}

type PageRaster = {
  raster: Raster
  canvas?: HTMLCanvasElement
  scale: number
  hasEmbeddedImage: boolean
}

async function loadColorRaster(page: PdfPage, lib: PdfjsModule): Promise<PageRaster> {
  const embedded = await extractEmbeddedImage(page, lib)
  if (embedded) {
    return {
      raster: embedded,
      canvas: colorCanvasFromRgb(embedded.data as Uint8Array, embedded.width, embedded.height, embedded.channels),
      scale: 1,
      hasEmbeddedImage: true,
    }
  }
  const base = page.getViewport({ scale: 1 })
  let scale = pickScale(base.width, base.height)
  const viewport = page.getViewport({ scale })
  if (viewport.width > MAX_CANVAS || viewport.height > MAX_CANVAS) {
    scale *= MAX_CANVAS / Math.max(viewport.width, viewport.height)
  }
  const canvas = await rasterizeCanvas(page, scale)
  if (!canvas) throw new Error('no-raster')
  return { raster: canvasToRaster(canvas), canvas, scale, hasEmbeddedImage: false }
}

function collectWords(page: {
  blocks?: Array<{ paragraphs: Array<{ lines: Array<{ words: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence?: number }> }> }> }> | null
}): OcrWord[] {
  const words: OcrWord[] = []
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          const text = word.text?.trim()
          if (!text) continue
          words.push({
            text,
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1,
            confidence: word.confidence,
          })
        }
      }
    }
  }
  return words
}

function cropRaster(raster: Raster, rect: ClassRect, scale: number): Raster {
  const w = Math.max(1, Math.round(rect.w * scale))
  const h = Math.max(1, Math.round(rect.h * scale))
  const out = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(raster.height - 1, rect.y + Math.floor(y / scale))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(raster.width - 1, rect.x + Math.floor(x / scale))
      const [r, g, b] = [
        raster.data[(sy * raster.width + sx) * raster.channels],
        raster.data[(sy * raster.width + sx) * raster.channels + Math.min(1, raster.channels - 1)],
        raster.data[(sy * raster.width + sx) * raster.channels + Math.min(2, raster.channels - 1)],
      ]
      const di = (y * w + x) * 3
      out[di] = r
      out[di + 1] = g
      out[di + 2] = b
    }
  }
  return { data: out, width: w, height: h, channels: 3 }
}

function cropToImage(
  raster: Raster,
  canvas: HTMLCanvasElement | undefined,
  rect: ClassRect,
  scale: number,
): HTMLCanvasElement | Buffer {
  if (canvas && typeof document !== 'undefined') {
    const dest = document.createElement('canvas')
    dest.width = Math.max(1, Math.round(rect.w * scale))
    dest.height = Math.max(1, Math.round(rect.h * scale))
    const ctx = dest.getContext('2d')
    if (ctx) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, dest.width, dest.height)
      return mildGrayCanvas(dest)
    }
  }
  const cropped = cropRaster(raster, rect, scale)
  const bmp = encodeBmp(cropped.data as Uint8Array, cropped.width, cropped.height, 3, 1)
  const NodeBuffer = (globalThis as { Buffer?: { from: (data: Uint8Array) => Buffer } }).Buffer
  if (!NodeBuffer) throw new Error('no-crop')
  return NodeBuffer.from(bmp)
}

function cropDataUrl(canvas: HTMLCanvasElement | undefined, rect: ClassRect): string | undefined {
  if (!canvas || typeof document === 'undefined') return undefined
  const dest = document.createElement('canvas')
  const sx = Math.max(0, Math.round(rect.x))
  const sy = Math.max(0, Math.round(rect.y))
  const sw = Math.max(1, Math.round(rect.w))
  const sh = Math.max(1, Math.round(rect.h))
  dest.width = sw
  dest.height = sh
  const ctx = dest.getContext('2d')
  if (!ctx) return undefined
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
  try {
    return dest.toDataURL('image/png')
  } catch {
    return undefined
  }
}

async function recognize(
  worker: TesseractWorker,
  image: HTMLCanvasElement | Buffer,
  mode: string,
): Promise<{ text: string; words: OcrWord[] }> {
  if (psm) {
    await worker.setParameters({ tessedit_pageseg_mode: mode as never })
  }
  const result = await worker.recognize(image, {}, { text: true, blocks: true })
  return { text: normalizeOcrNoise(result.data.text ?? ''), words: collectWords(result.data) }
}

function emptyDebug(): OcrDebug {
  return {
    hasEmbeddedImage: false,
    rasterWidth: 0,
    rasterHeight: 0,
    tesseractOk: false,
    wordCount: 0,
    sampleText: '',
    boxesOk: false,
    weekdayHeaders: 0,
    classBlocks: 0,
    courseCodes: 0,
    complete: 0,
    incomplete: 0,
    rejections: [],
  }
}

export async function ocrTimetablePage(
  page: PdfPage,
  lib: PdfjsModule,
  pageNumber: number,
  onProgress?: (update: OcrProgress) => void,
): Promise<OcrPageResult> {
  const debug = emptyDebug()
  onProgress?.({ message: `Page ${pageNumber} has no selectable text. Running OCR…` })
  const loaded = await loadColorRaster(page, lib)
  debug.hasEmbeddedImage = loaded.hasEmbeddedImage
  debug.rasterWidth = loaded.raster.width
  debug.rasterHeight = loaded.raster.height

  const grid = detectTimetableGrid(loaded.raster)
  const blocks = detectGreenClassBlocks(loaded.raster)
  debug.classBlocks = blocks.length
  onProgress?.({ message: blocks.length ? `Found ${blocks.length} class blocks. Reading each one…` : 'No colour blocks found. Reading the whole page…' })

  const worker = await getOcrWorker(onProgress)
  debug.tesseractOk = true
  const headerH = Math.max(28, Math.round(loaded.raster.height * 0.14))
  const axisW = Math.max(36, Math.round(loaded.raster.width * 0.12))
  const items: PdfTextItem[] = []

  const headerImg = cropToImage(loaded.raster, loaded.canvas, { x: 0, y: 0, w: loaded.raster.width, h: headerH }, 3)
  const axisImg = cropToImage(loaded.raster, loaded.canvas, { x: 0, y: headerH, w: axisW, h: loaded.raster.height - headerH }, 3)
  const header = await recognize(worker, headerImg, psm?.SINGLE_BLOCK ?? '6')
  const axis = await recognize(worker, axisImg, psm?.SPARSE_TEXT ?? '11')
  items.push(...ocrWordsToItems(header.words, pageNumber, 3))
  items.push(
    ...ocrWordsToItems(axis.words, pageNumber, 3).map((item) => ({
      ...item,
      y: item.y + headerH,
    })),
  )

  const blockTexts: { rect: ClassRect; text: string; cropDataUrl?: string }[] = []
  async function readRect(rect: ClassRect, index: number, total: number) {
    onProgress?.({ message: `Reading class ${index + 1} of ${total}…`, progress: (index + 1) / Math.max(1, total) })
    const scale = rect.h < 40 ? 5 : 4
    try {
      const image = cropToImage(loaded.raster, loaded.canvas, rect, scale)
      const read = await recognize(worker, image, psm?.SINGLE_BLOCK ?? '6')
      const mapped = ocrWordsToItems(read.words, pageNumber, scale).map((item) => ({
        ...item,
        x: item.x + rect.x,
        y: item.y + rect.y,
      }))
      return { text: read.text, mapped }
    } catch (error) {
      debug.rejections.push(`Block ${index + 1} OCR failed: ${error instanceof Error ? error.message : String(error)}`)
      return { text: '', mapped: [] as PdfTextItem[] }
    }
  }

  const splitQueue: ClassRect[] = []
  for (const [index, rect] of blocks.entries()) {
    const read = await readRect(rect, index, blocks.length)
    const parts = splitRectsByCourseHeaders(rect, read.mapped)
    if (parts.length > 1) {
      splitQueue.push(...parts)
      continue
    }
    items.push(...read.mapped)
    blockTexts.push({ rect, text: read.text, cropDataUrl: cropDataUrl(loaded.canvas, rect) })
  }
  for (const [index, rect] of splitQueue.entries()) {
    const read = await readRect(rect, blocks.length + index, blocks.length + splitQueue.length)
    items.push(...read.mapped)
    blockTexts.push({ rect, text: read.text, cropDataUrl: cropDataUrl(loaded.canvas, rect) })
  }

  if (!blocks.length) {
    const fullScale = pickScale(loaded.raster.width, loaded.raster.height)
    const full = cropToImage(
      loaded.raster,
      loaded.canvas,
      { x: 0, y: 0, w: loaded.raster.width, h: loaded.raster.height },
      fullScale,
    )
    const read = await recognize(worker, full, psm?.SPARSE_TEXT ?? '11')
    items.push(...ocrWordsToItems(read.words, pageNumber, fullScale))
  }

  debug.wordCount = items.length
  debug.sampleText = items
    .slice(0, 24)
    .map((item) => item.text)
    .join(' ')
  debug.boxesOk = items.some((item) => item.x > 0 && item.y > 0)
  const parsed = entriesFromClassBlocks({
    blocks: blockTexts,
    items,
    pageWidth: loaded.raster.width,
    pageHeight: loaded.raster.height,
    pageNumber,
    columns: grid?.columns,
  })
  debug.weekdayHeaders = parsed.weekdayHeaders
  debug.courseCodes = parsed.entries.filter((entry) => entry.courseCode).length
  debug.complete = parsed.complete
  debug.incomplete = parsed.incomplete
  debug.rejections.push(...parsed.rejections)

  return { items, entries: parsed.entries, debug }
}

export async function ocrPdfPage(
  page: PdfPage,
  lib: PdfjsModule,
  pageNumber: number,
  onProgress?: (update: OcrProgress) => void,
): Promise<PdfTextItem[]> {
  const result = await ocrTimetablePage(page, lib, pageNumber, onProgress)
  return result.items
}

const MAX_BYTES = 10 * 1024 * 1024

export type ExtractProgress = OcrProgress

async function loadPdfjs(): Promise<PdfjsModule> {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  }
  return pdfjs
}

export class PdfExtractError extends Error {
  readonly code: 'not-pdf' | 'too-large' | 'password' | 'damaged' | 'no-text' | 'empty' | 'ocr-init'

  constructor(message: string, code: PdfExtractError['code']) {
    super(message)
    this.name = 'PdfExtractError'
    this.code = code
  }
}

export type ExtractedPdf = {
  items: PdfTextItem[]
  pageCount: number
  usedOcr: boolean
  entries: ScheduleEntry[]
  debug?: OcrDebug
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export async function extractPdfFile(
  file: File,
  options: { onProgress?: (update: ExtractProgress) => void } = {},
): Promise<ExtractedPdf> {
  if (!isPdf(file)) throw new PdfExtractError('Please choose a PDF file.', 'not-pdf')
  if (file.size > MAX_BYTES) throw new PdfExtractError('That PDF is larger than 10 MB.', 'too-large')
  if (file.size === 0) throw new PdfExtractError('That PDF is empty.', 'empty')
  const data = new Uint8Array(await file.arrayBuffer())
  return extractPdfBytes(data, options)
}

export async function extractPdfBytes(
  data: Uint8Array,
  options: { onProgress?: (update: ExtractProgress) => void } = {},
): Promise<ExtractedPdf> {
  const bytes = new Uint8Array(data.byteLength)
  bytes.set(data)
  const lib = await loadPdfjs()
  let pdf: Awaited<ReturnType<PdfjsModule['getDocument']>['promise']> | undefined
  try {
    pdf = await lib.getDocument({
      data: bytes,
      useSystemFonts: true,
    }).promise
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/password/i.test(message)) throw new PdfExtractError('This PDF is password-protected.', 'password')
    throw new PdfExtractError('This PDF could not be opened. It may be damaged.', 'damaged')
  }

  let usedOcr = false
  let debug: OcrDebug | undefined
  try {
    const items: PdfTextItem[] = []
    const entries: ScheduleEntry[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      options.onProgress?.({ message: `Reading page ${pageNumber} of ${pdf.numPages}…` })
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const pageItems: PdfTextItem[] = []
      for (const raw of content.items) {
        if (!('str' in raw) || !raw.str.trim()) continue
        const tx = lib.Util.transform(viewport.transform, raw.transform)
        const x = tx[4]
        const y = tx[5]
        const height = Math.hypot(tx[2], tx[3])
        const width = raw.width ?? Math.hypot(tx[0], tx[1])
        pageItems.push({ text: raw.str, page: pageNumber, x, y, width, height })
      }

      const needsOcr = pageNeedsOcr(pageItems)
      const hasRaster = needsOcr && (await pageHasRasterContent(page as never, lib))
      if (needsOcr && hasRaster) {
        usedOcr = true
        try {
          const ocr = await ocrTimetablePage(page as never, lib, pageNumber, options.onProgress)
          debug = ocr.debug
          items.push(...(ocr.items.length ? ocr.items : pageItems))
          entries.push(...ocr.entries)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new PdfExtractError(
            `OCR could not start or finish in this browser (${message}). Add classes manually, or try again.`,
            'ocr-init',
          )
        }
      } else {
        items.push(...pageItems)
      }
    }
    if (!items.length && !entries.length) {
      throw new PdfExtractError(
        usedOcr
          ? 'OCR finished but recognized no timetable text or class blocks. Add classes manually instead.'
          : 'This PDF has no extractable text and no timetable image was found. Add classes manually instead.',
        'no-text',
      )
    }
    return { items, pageCount: pdf.numPages, usedOcr, entries, debug }
  } finally {
    const destroy = (pdf as { destroy?: () => Promise<void> | void } | undefined)?.destroy
    if (typeof destroy === 'function') await destroy.call(pdf)
    else {
      const cleanup = (pdf as { cleanup?: () => void } | undefined)?.cleanup
      if (typeof cleanup === 'function') cleanup.call(pdf)
    }
    if (usedOcr) await terminateOcrWorker()
  }
}
