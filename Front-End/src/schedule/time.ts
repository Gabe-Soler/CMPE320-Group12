import type { ActivityQuery, Location } from '../api'

export const KINGSTON_TZ = 'America/Toronto'

export type KingstonStamp = {
  date: string
  weekday: number
  minute: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
}

export function kingstonStamp(at: Date = new Date()): KingstonStamp {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: KINGSTON_TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const weekday = WEEKDAY_INDEX[get('weekday')] ?? 0
  const date = `${get('year')}-${get('month')}-${get('day')}`
  const minute = Number(get('hour')) * 60 + Number(get('minute'))
  return { date, weekday, minute }
}

export function dateWeekday(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d, 16, 0, 0))
  return kingstonStamp(utc).weekday
}

const NAME_TO_DAY: Record<string, number> = {
  monday: 0,
  mon: 0,
  tuesday: 1,
  tue: 1,
  tues: 1,
  wednesday: 2,
  wed: 2,
  thursday: 3,
  thu: 3,
  thur: 3,
  thurs: 3,
  friday: 4,
  fri: 4,
  saturday: 5,
  sat: 5,
  sunday: 6,
  sun: 6,
}

const COMBO_LETTER: Record<string, number> = { m: 0, t: 1, w: 2, r: 3, f: 4, s: 5, u: 6 }

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function parseWeekdays(text: string): number[] {
  const lower = text.toLowerCase()
  const found = new Set<number>()

  for (const [name, day] of Object.entries(NAME_TO_DAY)) {
    const re = new RegExp(`\\b${name}\\b`, 'i')
    if (re.test(lower)) found.add(day)
  }

  if (/\bmwf\b/.test(lower)) [0, 2, 4].forEach((d) => found.add(d))
  if (/\btr\b/.test(lower) || /\btth\b/.test(lower) || /\btuth\b/.test(lower)) {
    found.add(1)
    found.add(3)
  }
  if (/\bmw\b/.test(lower)) {
    found.add(0)
    found.add(2)
  }

  const compact = lower.replace(/[.\s]/g, '')
  const slashCombo = compact.match(/^(?:[mtwrfsu]\/){1,6}[mtwrfsu]$/)
  if (slashCombo) {
    for (const ch of compact.replace(/\//g, '')) {
      const day = COMBO_LETTER[ch]
      if (day !== undefined) found.add(day)
    }
  }
  for (const combo of compact.split(/[/,;&]+/)) {
    if (/^(?:[mtwrfsu]{2,7}|mwf|tr|mw|tth|tuth)$/.test(combo)) {
      const letters = combo.replace(/\//g, '')
      if (letters === 'tth' || letters === 'tuth') {
        found.add(1)
        found.add(3)
        continue
      }
      for (const ch of letters) {
        const day = COMBO_LETTER[ch]
        if (day !== undefined) found.add(day)
      }
    }
  }

  return [...found].sort((a, b) => a - b)
}

const LOCATION_DEPT =
  'HALL|ROOM|BLDG|BUILDING|LIBRARY|DUNNING|KINGSTON|GOODES|JEFFERY|JEFFREY|ELLIS|GOODWIN|STIRLING|DUPUIS|WALTER|COMPLEX|CENTRE|CENTER|AUDITORIUM|THEATRE|THEATER|BIOSCIENCES|CAMPUS|STREET|AVENUE|FLOOR|WING|TOWER|HOUSE|COLLEGE|SCHOOL|OFFICE|SCIENCE|CHERNOFF|AUD'

const DEPT = `(?!${LOCATION_DEPT})[A-Z]{2,8}`
export const COURSE_CODE_PATTERN = new RegExp(`\\b(${DEPT})\\s+(\\d{2,4}[A-Z]?)\\b`, 'i')
export const COURSE_SECTION_PATTERN = new RegExp(`\\b(${DEPT})\\s+(\\d{2,4}[A-Z]?)\\s*[-–]\\s*(\\d{2,4})\\b`, 'i')

const COMPONENTS: Record<string, string> = {
  lecture: 'Lecture',
  lec: 'Lecture',
  laboratory: 'Lab',
  lab: 'Lab',
  tutorial: 'Tutorial',
  tut: 'Tutorial',
  seminar: 'Seminar',
  sem: 'Seminar',
}

const LOCATION_SET = new Set(LOCATION_DEPT.split('|'))

export function isLocationDept(word: string): boolean {
  return LOCATION_SET.has(word.trim().toUpperCase())
}

export function isLikelyCourseMatch(dept: string, number: string): boolean {
  if (isLocationDept(dept)) return false
  if (parseComponent(dept)) return false
  if (dept.length < 2 || dept.length > 8) return false
  if (!/^\d{2,4}[A-Z]?$/i.test(number)) return false
  return true
}

export function parseCourse(text: string): { courseCode?: string; section?: string; title: string } {
  const sectionRe = new RegExp(COURSE_SECTION_PATTERN.source, 'gi')
  for (const section of text.matchAll(sectionRe)) {
    if (!isLikelyCourseMatch(section[1], section[2])) continue
    const courseCode = `${section[1].toUpperCase()} ${section[2]}`
    return { courseCode, section: section[3].padStart(3, '0'), title: courseCode }
  }
  const codeRe = new RegExp(COURSE_CODE_PATTERN.source, 'gi')
  for (const code of text.matchAll(codeRe)) {
    if (!isLikelyCourseMatch(code[1], code[2])) continue
    const courseCode = `${code[1].toUpperCase()} ${code[2]}`
    return { courseCode, title: courseCode }
  }
  return { title: text.trim() }
}

export function parseComponent(text: string): string | undefined {
  const match = text.match(/\b(lecture|laboratory|tutorial|seminar|lab|lec|tut|sem)\b/i)
  if (!match) return undefined
  return COMPONENTS[match[1].toLowerCase()]
}

export function newId(): string {
  return `cls_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export type ClockParse = { ok: true; minute: number } | { ok: false; reason: 'invalid' | 'ambiguous' }

/** Conservative OCR clean-up for timetable times. Does not invent missing hours. */
export function normalizeOcrNoise(text: string): string {
  return text
    .replace(/[|]/g, 'I')
    .replace(/(\d)FM\b/gi, '$1PM')
    .replace(/\bFM\b/g, 'PM')
    .replace(/\b(\d{1,2}:\d{2})4M\b/gi, '$1AM')
    .replace(/\bB:(?=\d{2})/g, '8:')
    .replace(/\bS:(?=\d{2})/g, '9:')
    .replace(/\bO:(?=\d{2})/g, '0:')
    .replace(/\bl:(?=\d{2})/g, '1:')
    .replace(/\b0:30\s*AM\b/gi, '9:30 AM')
    .replace(/\b0:30AM\b/gi, '9:30AM')
}

const TIME_TOKEN =
  /\b(?:([01]?\d|2[0-3])(?::([0-5]\d))?\s*(?:h)?\s*(a\.?m\.?|p\.?m\.?)?)\b/gi

export function parseClock(raw: string, as24HourRange = false): ClockParse {
  const text = raw.trim().toLowerCase().replace(/\s+/g, '')
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?(am|pm|a\.m\.|p\.m\.)?$/)
  if (!match) return { ok: false, reason: 'invalid' }

  const hour = Number(match[1])
  const minute = match[2] === undefined ? 0 : Number(match[2])
  const suffix = match[3]?.replace(/\./g, '')
  if (minute > 59) return { ok: false, reason: 'invalid' }

  if (suffix === 'am' || suffix === 'pm') {
    if (hour < 1 || hour > 12) return { ok: false, reason: 'invalid' }
    const hour24 = hour % 12 + (suffix === 'pm' ? 12 : 0)
    return { ok: true, minute: hour24 * 60 + minute }
  }

  if (hour > 23) return { ok: false, reason: 'invalid' }
  // Canonical "HH:MM" (two-digit hour) is 24-hour time, as is 13:00–23:59.
  if (hour > 12 || /^\d{2}:\d{2}$/.test(text) || (as24HourRange && match[2] !== undefined))
    return { ok: true, minute: hour * 60 + minute }
  return { ok: false, reason: 'ambiguous' }
}

export function formatClock(minute: number): string {
  const wrapped = ((minute % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function clockLabel(minute: number): string {
  const wrapped = ((minute % 1440) + 1440) % 1440
  const h24 = Math.floor(wrapped / 60)
  const m = wrapped % 60
  if (wrapped === 0) return '12:00 AM'
  const suffix = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

export function extractTimeRange(text: string): {
  start?: ClockParse
  end?: ClockParse
  raw: string[]
} {
  const tokens = [...text.matchAll(TIME_TOKEN)].map((m) => m[0])
  const range24 = tokens.filter((t) => t.includes(':') && !/[ap]m/i.test(t)).length >= 2
  const parsed = tokens.map((token) => parseClock(token, range24))
  const times = parsed.filter((p): p is { ok: true; minute: number } => p.ok)
  const ambiguous = parsed.some((p) => !p.ok && p.reason === 'ambiguous')

  if (times.length >= 2) return { start: times[0], end: times[1], raw: tokens }
  if (times.length === 1) {
    const only = times[0]
    return {
      start: only,
      end: ambiguous ? { ok: false, reason: 'ambiguous' } : undefined,
      raw: tokens,
    }
  }
  if (ambiguous) return { start: { ok: false, reason: 'ambiguous' }, raw: tokens }
  return { raw: tokens }
}

export function parseDate(text: string): string | undefined {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (iso) {
    const y = Number(iso[1]),
      mo = Number(iso[2]),
      d = Number(iso[3])
    if (validYmd(y, mo, d)) return `${iso[1]}-${iso[2]}-${iso[3]}`
  }

  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/)
  const months: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  }
  const named = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b/i,
  )

  let year = Number(kingstonStamp().date.slice(0, 4))
  let month = 0
  let day = 0
  if (named) {
    month = months[named[1].toLowerCase()]
    day = Number(named[2])
    if (named[3]) year = Number(named[3])
  } else if (numeric) {
    month = Number(numeric[1])
    day = Number(numeric[2])
    if (numeric[3]) year = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
    // SOLUS-style M/D when month > 12 is actually D/M — reject rather than guess.
    if (month > 12 && day <= 12) return undefined
  } else return undefined

  if (!validYmd(year, month, day)) return undefined
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function validYmd(year: number, month: number, day: number): boolean {
  const dt = new Date(Date.UTC(year, month - 1, day))
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day
}

// Weekdays match the C++ backend: 0 = Monday ... 6 = Sunday.

export type PdfTextItem = {
  text: string
  page: number
  x: number
  y: number
  width?: number
  height?: number
}

export type ExtractionWarning =
  | 'missing-day'
  | 'missing-start'
  | 'missing-end'
  | 'ambiguous-ampm'
  | 'unrecognized-layout'
  | 'missing-location'
  | 'possible-duplicate'
  | 'uncertain-grid'
  | 'incomplete'
  | 'missing-course'
  | 'grid-time'
  | 'ocr-mismatch'
  | 'possible-merge'

export type Confidence = 'high' | 'medium' | 'low'

export type ScheduleEntry = {
  id: string
  title: string
  courseCode?: string
  section?: string
  component?: string
  days: number[]
  startTime: string
  endTime: string
  location?: string
  startDate?: string
  endDate?: string
  repeatsWeekly: boolean
  source: 'pdf' | 'manual'
  warnings: ExtractionWarning[]
  confidence: Confidence
  cropDataUrl?: string
}

export type ParseResult = {
  entries: ScheduleEntry[]
  layout: 'queens-week' | 'table' | 'linear' | 'unknown'
  warnings: string[]
}

export type FreePeriod = {
  date: string
  weekday: number
  startMinute: number
  endMinute: number
  minutes: number
  fromEntryId?: string
  toEntryId?: string
  fromLocation?: string
  toLocation?: string
}

export type StoredSchedule = {
  version: 1
  entries: ScheduleEntry[]
  updatedAt: string
}

const INFORMATIONAL: ExtractionWarning[] = [
  'possible-duplicate',
  'uncertain-grid',
  'grid-time',
  'ocr-mismatch',
  'possible-merge',
  'unrecognized-layout',
  'missing-location',
]

export function entryIssues(entry: Partial<ScheduleEntry>): ExtractionWarning[] {
  const warnings: ExtractionWarning[] = []
  const add = (w: ExtractionWarning) => {
    if (!warnings.includes(w)) warnings.push(w)
  }

  const courseCode = entry.courseCode?.trim() || parseCourse(entry.title ?? '').courseCode
  if (!entry.title?.trim()) add('incomplete')
  if (!entry.days?.length) add('missing-day')
  if (entry.source === 'pdf' && !courseCode) add('missing-course')

  const start = entry.startTime ? parseClock(entry.startTime) : { ok: false as const, reason: 'invalid' as const }
  const end = entry.endTime ? parseClock(entry.endTime) : { ok: false as const, reason: 'invalid' as const }
  if (!entry.startTime) add('missing-start')
  else if (!start.ok && start.reason === 'ambiguous') add('ambiguous-ampm')
  else if (!start.ok) add('missing-start')

  if (!entry.endTime) add('missing-end')
  else if (!end.ok && end.reason === 'ambiguous') add('ambiguous-ampm')
  else if (!end.ok) add('missing-end')

  if (start.ok && end.ok && end.minute <= start.minute) add('incomplete')
  if (!entry.location?.trim()) add('missing-location')

  for (const warning of entry.warnings ?? []) {
    if (INFORMATIONAL.includes(warning)) add(warning)
  }
  return warnings
}

export function isComplete(entry: Partial<ScheduleEntry>): boolean {
  const blocking: ExtractionWarning[] = [
    'missing-day',
    'missing-start',
    'missing-end',
    'ambiguous-ampm',
    'incomplete',
  ]
  return entryIssues(entry).every((w) => !blocking.includes(w))
}

export function confidenceOf(warnings: ExtractionWarning[]): Confidence {
  if (warnings.some((w) => ['missing-day', 'missing-start', 'missing-end', 'ambiguous-ampm', 'incomplete', 'missing-course'].includes(w)))
    return 'low'
  if (warnings.some((w) => ['uncertain-grid', 'unrecognized-layout', 'possible-duplicate', 'grid-time', 'ocr-mismatch', 'possible-merge'].includes(w)))
    return 'medium'
  if (warnings.includes('missing-location')) return 'medium'
  return 'high'
}

export function normalizeEntry(entry: ScheduleEntry): ScheduleEntry {
  const parsed = parseCourse(entry.title)
  const courseCode = entry.courseCode?.trim() || parsed.courseCode
  const start = entry.startTime ? parseClock(entry.startTime) : undefined
  const end = entry.endTime ? parseClock(entry.endTime) : undefined
  const next: ScheduleEntry = {
    ...entry,
    title: entry.title.trim(),
    courseCode,
    days: [...new Set(entry.days)].sort((a, b) => a - b),
    startTime: start?.ok ? formatClock(start.minute) : entry.startTime,
    endTime: end?.ok ? formatClock(end.minute) : entry.endTime,
    location: entry.location?.trim() || undefined,
  }
  const warnings = entryIssues(next).filter((w) => w !== 'missing-location' || !next.location)
  return {
    ...next,
    warnings,
    confidence: confidenceOf(warnings),
  }
}

export function sameMeeting(a: ScheduleEntry, b: ScheduleEntry): boolean {
  return (
    a.courseCode === b.courseCode &&
    a.component === b.component &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    a.startDate === b.startDate &&
    a.days.join() === b.days.join() &&
    (a.location ?? '') === (b.location ?? '')
  )
}

export function dedupeMeetings(entries: ScheduleEntry[]): ScheduleEntry[] {
  const out: ScheduleEntry[] = []
  for (const entry of entries) {
    const dup = out.find((other) => sameMeeting(other, entry))
    if (dup) {
      if (!dup.warnings.includes('possible-duplicate')) dup.warnings.push('possible-duplicate')
      dup.confidence = confidenceOf(dup.warnings)
      continue
    }
    out.push(entry)
  }
  return out
}

export const STORAGE_KEY = 'board-im-bored.schedule.v1'

function isEntry(value: unknown): value is ScheduleEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as ScheduleEntry
  return (
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    Array.isArray(entry.days) &&
    typeof entry.startTime === 'string' &&
    typeof entry.endTime === 'string' &&
    (entry.source === 'pdf' || entry.source === 'manual')
  )
}

export function loadSchedule(): StoredSchedule | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { version?: number; entries?: unknown; updatedAt?: string }
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return null
    const entries = parsed.entries.filter(isEntry).map((entry) =>
      normalizeEntry({
        ...entry,
        repeatsWeekly: Boolean(entry.repeatsWeekly),
        warnings: Array.isArray(entry.warnings) ? entry.warnings : [],
        confidence: entry.confidence ?? 'high',
      }),
    )
    return { version: 1, entries, updatedAt: parsed.updatedAt ?? '' }
  } catch {
    return null
  }
}

export function saveSchedule(entries: ScheduleEntry[]): StoredSchedule {
  const stored: StoredSchedule = {
    version: 1,
    entries: entries.map((entry) => {
      const next = normalizeEntry(entry)
      delete next.cropDataUrl
      return next
    }),
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  return stored
}

export function clearSchedule(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function storageAvailable(): boolean {
  try {
    const key = `${STORAGE_KEY}.probe`
    localStorage.setItem(key, '1')
    localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export type LandmarkMatch = {
  landmarkId?: string
  displayLocation: string
  unresolved: boolean
}

const ALIASES: Record<string, string> = {
  'ellis hall': 'ellis-hall',
  'kingston hall': 'kingston-hall',
  'walter light hall': 'walter-light',
  'walter light': 'walter-light',
  wlh: 'walter-light',
  'stirling hall': 'stirling-hall',
  'jeffery hall': 'jeffery-hall',
  'jeffrey hall': 'jeffery-hall',
  'dunning hall': 'dunning-hall',
  'macdonald hall': 'macdonald-hall',
  'mcdonald hall': 'macdonald-hall',
  'chernoff hall': 'chernoff-hall',
  'dupuis hall': 'dupuis-hall',
  'beamish munro hall': 'beamish-munro',
  'beamish munro': 'beamish-munro',
  bmh: 'beamish-munro',
  'biosciences complex': 'biosciences-complex',
  'bioscience complex': 'biosciences-complex',
  biosci: 'biosciences-complex',
  'goodwin hall': 'goodwin-hall',
  'stauffer library': 'stauffer-library',
  stauffer: 'stauffer-library',
  arc: 'arc',
  'union street': 'union-street',
  'west campus': 'west-campus',
}

const ROOM_TOKEN = /^(?:\d+[a-z]?|aud|auditorium|rm|room|[a-z])$/

export function normalizeLandmarkText(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildingNameFromClassroom(text: string): string {
  const tokens = normalizeLandmarkText(text).split(' ').filter(Boolean)
  while (tokens.length && ROOM_TOKEN.test(tokens[tokens.length - 1] ?? '')) tokens.pop()
  return tokens.join(' ')
}

export function mappedLandmarks(locations: Location[]): Location[] {
  return locations.filter((place) => place.id !== 'anywhere')
}

function byId(locations: Location[], id: string | undefined): Location | undefined {
  if (!id) return undefined
  return mappedLandmarks(locations).find((place) => place.id === id)
}

export function resolveLandmark(locationText: string | undefined, locations: Location[]): LandmarkMatch {
  const displayLocation = locationText?.trim() ?? ''
  if (!displayLocation) return { displayLocation, unresolved: true }

  const building = buildingNameFromClassroom(displayLocation)
  if (!building) return { displayLocation, unresolved: true }

  const aliased = ALIASES[building]
  const exactName = mappedLandmarks(locations).find((place) => normalizeLandmarkText(place.name) === building)
  const exactId = mappedLandmarks(locations).find((place) => place.id.replace(/-/g, ' ') === building)

  const ids = new Set<string>()
  if (aliased) ids.add(aliased)
  if (exactName) ids.add(exactName.id)
  if (exactId) ids.add(exactId.id)

  if (ids.size !== 1) return { displayLocation, unresolved: true }

  const landmarkId = [...ids][0]
  if (!byId(locations, landmarkId)) return { displayLocation, unresolved: true }

  return { landmarkId, displayLocation, unresolved: false }
}

export function matchLandmark(locationText: string | undefined, locations: Location[]): Location | undefined {
  const resolved = resolveLandmark(locationText, locations)
  return byId(locations, resolved.landmarkId)
}

export type GapKind = 'between' | 'after-last' | 'before-first' | 'empty-day'

export type GapLandmarks = {
  kind: GapKind
  hasPreviousClass: boolean
  hasNextClass: boolean
  from: LandmarkMatch
  to: LandmarkMatch
  requiresFrom: boolean
  requiresTo: boolean
  fromId: string
  toId: string
}

export function gapLandmarkCopy(kind: GapKind) {
  if (kind === 'before-first') {
    return {
      fromLabel: 'Where you are now',
      toLabel: 'Closest mapped building',
      fromPlaceholder: 'Choose where you are now',
      toPlaceholder: 'Class building is not on the walking map',
      help: 'Activities that fit before this class, including walking time from the activity to class and a 5-minute arrival buffer.',
    }
  }
  if (kind === 'after-last') {
    return {
      fromLabel: 'Walking from',
      toLabel: 'Destination',
      fromPlaceholder: 'Choose a starting landmark',
      toPlaceholder: 'No required destination',
      help: 'This is after your last class today, so there is no required destination. Search is one-way (not a return trip). Classroom names that are not on the walking map have to be matched by hand.',
    }
  }
  if (kind === 'between') {
    return {
      fromLabel: 'Walking from (previous class)',
      toLabel: 'Walking to (next class)',
      fromPlaceholder: 'Choose the previous class landmark',
      toPlaceholder: 'Class building is not on the walking map',
      help: 'We’ll list activities that fit between these classes. Walk time to the activity and from the activity to the next class is included, with a 5-minute arrival buffer.',
    }
  }
  return {
    fromLabel: 'Where you are now',
    toLabel: 'Destination',
    fromPlaceholder: 'Choose where you are now',
    toPlaceholder: 'No required destination',
    help: 'There are no classes on this date. Pick a start if you still want ideas. Search is one-way unless you choose a destination.',
  }
}

export function gapKind(gap: FreePeriod): GapKind {
  if (gap.fromEntryId && gap.toEntryId) return 'between'
  if (gap.fromEntryId && !gap.toEntryId) return 'after-last'
  if (!gap.fromEntryId && gap.toEntryId) return 'before-first'
  return 'empty-day'
}

export function landmarksForFreePeriod(gap: FreePeriod, locations: Location[]): GapLandmarks {
  const kind = gapKind(gap)
  const hasPreviousClass = Boolean(gap.fromEntryId)
  const hasNextClass = Boolean(gap.toEntryId)
  const from = resolveLandmark(gap.fromLocation, locations)
  const to = resolveLandmark(gap.toLocation, locations)

  const requiresFrom = kind === 'empty-day' || (hasPreviousClass && !from.landmarkId)
  const requiresTo = hasNextClass && !to.landmarkId

  return {
    kind,
    hasPreviousClass,
    hasNextClass,
    from: hasPreviousClass ? from : { displayLocation: '', unresolved: true },
    to: hasNextClass ? to : { displayLocation: gap.toLocation ?? '', unresolved: false },
    requiresFrom,
    requiresTo,
    fromId: hasPreviousClass ? (from.landmarkId ?? '') : kind === 'before-first' ? 'anywhere' : '',
    toId: hasNextClass ? (to.landmarkId ?? '') : '',
  }
}

export type ScheduleSearchDraft = ActivityQuery & { locationName: string }

export function scheduleSearchFromGap(
  gap: FreePeriod,
  fromId: string,
  toId: string,
  locations: Location[],
): { ok: true; search: ScheduleSearchDraft } | { ok: false; error: string } {
  const auto = landmarksForFreePeriod(gap, locations)
  const mappedFrom = mappedLandmarks(locations).find((place) => place.id === fromId)
  const anywhere = locations.find((place) => place.id === 'anywhere')
  const to = toId ? mappedLandmarks(locations).find((place) => place.id === toId) : undefined
  const from = mappedFrom ?? (!auto.hasPreviousClass ? anywhere : undefined)

  if (mappedLandmarks(locations).length === 0) {
    return { ok: false, error: 'Campus landmarks could not be loaded. Activity search needs the locations API.' }
  }
  if (auto.hasPreviousClass && !mappedFrom) {
    return {
      ok: false,
      error: auto.from.displayLocation
        ? `Could not match “${auto.from.displayLocation}” to a campus landmark. Pick where you are walking from.`
        : 'Pick a mapped campus landmark for where you are starting. Unknown buildings are not treated as zero walk.',
    }
  }
  if (!from) {
    return {
      ok: false,
      error: 'Pick a mapped campus landmark for where you are starting. Unknown buildings are not treated as zero walk.',
    }
  }
  if (auto.hasNextClass && !to) {
    return {
      ok: false,
      error: auto.to.displayLocation
        ? `Could not match “${auto.to.displayLocation}” to a campus landmark, so walking time from the activity to class cannot be counted.`
        : 'That class building is not on the walking map, so walking time from the activity cannot be counted.',
    }
  }

  const hasDestination = Boolean(to)
  return {
    ok: true,
    search: {
      minutes: gap.minutes,
      locationId: from.id,
      locationName: from.id === 'anywhere' && to ? to.name : from.name,
      at: `${gap.date}T${formatClock(gap.startMinute)}`,
      destinationId: to?.id,
      until: formatClock(gap.endMinute),
      buffer: hasDestination ? 5 : 0,
      scheduleAware: true,
    },
  }
}

export type FreePeriodOptions = {
  date: string
  dayStartMinute?: number
  dayEndMinute?: number
  minGapMinutes?: number
  includeEndsOfDay?: boolean
}

type Interval = {
  start: number
  end: number
  entryId: string
  location?: string
}

function meetingsOnDate(entries: ScheduleEntry[], date: string): Interval[] {
  const weekday = dateWeekday(date)
  const intervals: Interval[] = []
  for (const entry of entries) {
    if (!entry.days.includes(weekday)) continue
    if (entry.startDate && date < entry.startDate) continue
    if (entry.endDate && date > entry.endDate) continue
    if (!entry.repeatsWeekly && entry.startDate && !entry.endDate && entry.startDate !== date) continue
    const start = parseClock(entry.startTime)
    const end = parseClock(entry.endTime)
    if (!start.ok || !end.ok || end.minute <= start.minute) continue
    intervals.push({ start: start.minute, end: end.minute, entryId: entry.id, location: entry.location?.trim() })
  }
  intervals.sort((a, b) => a.start - b.start || a.end - b.end)
  return intervals
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const merged: Interval[] = []
  for (const item of intervals) {
    const last = merged[merged.length - 1]
    if (last && item.start <= last.end) {
      if (item.end >= last.end) {
        last.end = item.end
        last.entryId = item.entryId
        last.location = item.location
      }
      continue
    }
    merged.push({ ...item })
  }
  return merged
}

export function freePeriods(entries: ScheduleEntry[], options: FreePeriodOptions): FreePeriod[] {
  const weekday = dateWeekday(options.date)
  const dayStart = options.dayStartMinute ?? 8 * 60
  const dayEnd = options.dayEndMinute ?? 22 * 60
  const minGap = options.minGapMinutes ?? 15
  const includeEnds = options.includeEndsOfDay ?? true
  const merged = mergeIntervals(meetingsOnDate(entries, options.date))
  const gaps: FreePeriod[] = []

  const push = (start: number, end: number, from?: Interval, to?: Interval) => {
    const minutes = end - start
    if (minutes < minGap) return
    gaps.push({
      date: options.date,
      weekday,
      startMinute: start,
      endMinute: end,
      minutes,
      fromEntryId: from?.entryId,
      toEntryId: to?.entryId,
      fromLocation: from?.location,
      toLocation: to?.location,
    })
  }

  if (merged.length === 0) {
    if (includeEnds) push(dayStart, dayEnd)
    return gaps
  }
  if (includeEnds && merged[0].start - dayStart >= minGap) push(dayStart, merged[0].start, undefined, merged[0])
  for (let i = 0; i < merged.length - 1; i++) push(merged[i].end, merged[i + 1].start, merged[i], merged[i + 1])
  const last = merged[merged.length - 1]
  if (includeEnds && dayEnd - last.end >= minGap) push(last.end, dayEnd, last, undefined)
  return gaps
}

export function overlappingPairs(entries: ScheduleEntry[], date: string): [ScheduleEntry, ScheduleEntry][] {
  const weekday = dateWeekday(date)
  const ofDay = entries.filter((entry) => {
    if (!entry.days.includes(weekday)) return false
    if (entry.startDate && !entry.repeatsWeekly && entry.startDate !== date) return false
    const start = parseClock(entry.startTime)
    const end = parseClock(entry.endTime)
    return start.ok && end.ok
  })
  const pairs: [ScheduleEntry, ScheduleEntry][] = []
  for (let i = 0; i < ofDay.length; i++) {
    for (let j = i + 1; j < ofDay.length; j++) {
      const a0 = parseClock(ofDay[i].startTime)
      const a1 = parseClock(ofDay[i].endTime)
      const b0 = parseClock(ofDay[j].startTime)
      const b1 = parseClock(ofDay[j].endTime)
      if (!a0.ok || !a1.ok || !b0.ok || !b1.ok) continue
      if (a0.minute < b1.minute && b0.minute < a1.minute) pairs.push([ofDay[i], ofDay[j]])
    }
  }
  return pairs
}
