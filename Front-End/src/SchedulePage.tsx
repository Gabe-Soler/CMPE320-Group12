import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { ActivityQuery, Location } from './api'
import { extractPdfFile, parseTimetable, PdfExtractError } from './schedule/parseTimetable'
import {
  clearSchedule,
  clockLabel,
  DAY_NAMES,
  DAY_SHORT,
  entryIssues,
  formatClock,
  freePeriods,
  gapLandmarkCopy,
  isComplete,
  kingstonStamp,
  landmarksForFreePeriod,
  loadSchedule,
  mappedLandmarks,
  newId,
  normalizeEntry,
  overlappingPairs,
  parseClock,
  saveSchedule,
  scheduleSearchFromGap,
  storageAvailable,
  type ScheduleEntry,
} from './schedule/time'

type Mode = 'home' | 'review' | 'week' | 'form'

function activate(event: KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

function Action({
  children,
  onClick,
  variant = 'primary',
  className = '',
  disabled = false,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'quiet'
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const styles = {
    primary: 'bg-ink text-paper border-ink hover:bg-red hover:text-paper',
    secondary: 'bg-paper text-ink border-ink hover:bg-cloud',
    quiet: 'bg-transparent text-ink border-transparent hover:bg-cloud',
  }
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`select-none cursor-pointer border-2 rounded-full px-5 py-3 font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export type ScheduleSearch = ActivityQuery & { locationName: string; untilLabel?: string }

export default function SchedulePage({
  locations,
  locationsStatus = 'ready',
  onReloadLocations,
  onBack,
  onFind,
}: {
  locations: Location[]
  locationsStatus?: 'loading' | 'ready' | 'error'
  onReloadLocations?: () => void
  onBack: () => void
  onFind: (search: ScheduleSearch) => void
}) {
  const saved = loadSchedule()
  const [mode, setMode] = useState<Mode>(saved?.entries.length ? 'week' : 'home')
  const [entries, setEntries] = useState<ScheduleEntry[]>(saved?.entries ?? [])
  const [draft, setDraft] = useState<ScheduleEntry[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<ScheduleEntry | null>(null)
  const [replaceAsk, setReplaceAsk] = useState<ScheduleEntry[] | null>(null)
  const [gapDate, setGapDate] = useState(kingstonStamp().date)
  const [pickGap, setPickGap] = useState<ReturnType<typeof freePeriods>[number] | null>(null)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [fromDirty, setFromDirty] = useState(false)
  const [toDirty, setToDirty] = useState(false)
  const [layoutNote, setLayoutNote] = useState('')
  const [extractDebug, setExtractDebug] = useState('')

  const persist = (next: ScheduleEntry[]) => {
    const complete = next.filter((entry) => isComplete(entry))
    if (storageAvailable()) saveSchedule(complete)
    setEntries(complete)
  }

  const openReview = (parsed: ScheduleEntry[], note: string) => {
    setLayoutNote(note)
    const existing = loadSchedule()?.entries ?? []
    if (existing.length) setReplaceAsk(parsed)
    else {
      setDraft(parsed)
      setMode('review')
    }
  }

  const onUpload = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setBusy(true)
    setStatus('Reading PDF in this browser…')
    try {
      const extracted = await extractPdfFile(file, {
        onProgress: (update) => setStatus(update.message),
      })
      const parsed = extracted.entries.length
        ? { entries: extracted.entries, layout: 'queens-week' as const, warnings: extracted.debug?.rejections ?? [] }
        : parseTimetable(extracted.items)
      if (extracted.debug) {
        const d = extracted.debug
        setExtractDebug(
          [
            `Embedded image: ${d.hasEmbeddedImage}`,
            `Raster: ${d.rasterWidth}×${d.rasterHeight}`,
            `Tesseract: ${d.tesseractOk ? 'ok' : 'failed'}`,
            `OCR words: ${d.wordCount}`,
            `Sample: ${d.sampleText || '(none)'}`,
            `Boxes: ${d.boxesOk}`,
            `Weekday headers: ${d.weekdayHeaders}`,
            `Class blocks: ${d.classBlocks}`,
            `Course codes: ${d.courseCodes}`,
            `Complete / incomplete: ${d.complete} / ${d.incomplete}`,
            d.rejections.length ? `Notes: ${d.rejections.join(' | ')}` : '',
            d.error ? `Error: ${d.error}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        )
      } else setExtractDebug('')
      if (!parsed.entries.length) {
        if (extracted.debug?.classBlocks) {
          setError('Class blocks were detected but none could be turned into review rows. Use extraction details below, then add classes manually.')
        } else if (extracted.usedOcr) {
          setError(parsed.warnings[0] ?? 'OCR ran, but the timetable layout was not recognized. Add classes manually.')
        } else {
          setError(parsed.warnings[0] ?? 'No classes were recognized. Add them manually.')
        }
        setStatus('')
        return
      }
      const ocrNote = extracted.usedOcr
        ? ' Some pages had no selectable text, so OCR ran in this browser. Please check every class. Times inferred from the grid are marked and are not treated as confirmed.'
        : ''
      const note = `${parsed.entries.length} timetable entries detected. ${parsed.entries.filter((e) => !isComplete(e)).length} need review.${parsed.warnings.length ? ' ' + parsed.warnings.join(' ') : ''}${ocrNote} Layout: ${parsed.layout}. This import is for the week shown in the PDF unless you choose Repeat weekly.`
      openReview(parsed.entries, note)
      setStatus('')
    } catch (caught) {
      setError(caught instanceof PdfExtractError ? caught.message : 'Could not read that file.')
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const confirmDraft = () => {
    const ready = draft.filter((entry) => isComplete(entry))
    const leftover = draft.filter((entry) => !isComplete(entry))
    if (!ready.length) {
      setError(
        leftover.length
          ? `Fix or delete ${leftover.length} incomplete ${leftover.length === 1 ? 'class' : 'classes'} before saving. Each class needs a name, a weekday, and a start time before the end time.`
          : 'No classes to save.',
      )
      return
    }
    persist(ready)
    if (leftover.length) {
      setDraft(leftover)
      setError(
        `Saved ${ready.length} ${ready.length === 1 ? 'class' : 'classes'}. ${leftover.length} still need a weekday or start/end times.`,
      )
      setStatus('')
      return
    }
    setDraft([])
    setMode('week')
    setStatus('Schedule saved in this browser only. Clearing site data will remove it.')
    setError('')
  }

  const gaps = useMemo(
    () => freePeriods(entries, { date: gapDate, minGapMinutes: 15, includeEndsOfDay: true }),
    [entries, gapDate],
  )
  const overlaps = useMemo(() => overlappingPairs(entries, gapDate), [entries, gapDate])
  const landmarks = useMemo(() => mappedLandmarks(locations), [locations])
  const gapAuto = pickGap ? landmarksForFreePeriod(pickGap, locations) : null
  const gapCopy = gapAuto ? gapLandmarkCopy(gapAuto.kind) : null

  useEffect(() => {
    setPickGap((current) => (current && current.date === gapDate ? current : null))
  }, [gapDate])

  useEffect(() => {
    if (!pickGap) return
    const auto = landmarksForFreePeriod(pickGap, locations)
    if (!fromDirty) setFromId(auto.fromId)
    if (!toDirty) setToId(auto.toId)
  }, [pickGap, locations, fromDirty, toDirty])

  const startSearch = (gap: (typeof gaps)[number]) => {
    const auto = landmarksForFreePeriod(gap, locations)
    setError('')
    setPickGap(gap)
    setFromDirty(false)
    setToDirty(false)
    setFromId(auto.fromId)
    setToId(auto.toId)
    if (locationsStatus === 'ready' && !auto.requiresFrom && !auto.requiresTo) {
      const result = scheduleSearchFromGap(gap, auto.fromId, auto.toId, locations)
      if (result.ok) {
        onFind(result.search)
        return
      }
      setError(result.error)
    }
  }

  const runSearch = () => {
    if (!pickGap) return
    const result = scheduleSearchFromGap(pickGap, fromId, toId, locations)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError('')
    onFind(result.search)
  }

  return (
    <main className="flex-1 py-10 md:py-14">
      <Action variant="quiet" onClick={onBack} className="w-fit mb-7">
        ← Home
      </Action>

      <div className="text-xs font-bold tracking-widest">MY SCHEDULE</div>
      <h1 className="text-4xl md:text-6xl font-black tracking-tight mt-2">Classes, then downtime.</h1>
      <p className="text-muted text-lg mt-3 max-w-2xl">
        Upload a timetable PDF from Queen’s SOLUS.
      </p>

      {error && (
        <div className="mt-6 border-2 border-ink bg-yellow px-5 py-4 font-semibold" role="alert">
          {error}
        </div>
      )}
      {(status || busy) && (
        <p className="mt-4 text-muted" aria-live="polite">
          {status || 'Working…'}
        </p>
      )}
      {extractDebug && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-semibold">Extraction details</summary>
          <pre className="mt-2 whitespace-pre-wrap border-2 border-ink rounded-2xl p-4 bg-cloud">{extractDebug}</pre>
        </details>
      )}

      {replaceAsk && (
        <div className="mt-6 border-2 border-ink rounded-3xl p-6 bg-paper shadow-hard">
          <div className="font-black text-2xl">Replace the saved schedule?</div>
          <p className="mt-2 text-muted">
            You already have {loadSchedule()?.entries.length} saved {loadSchedule()?.entries.length === 1 ? 'class' : 'classes'}.
            Replacing discards them. Keeping them leaves this import unsaved.
          </p>
          <div className="flex flex-wrap gap-3 mt-5">
            <Action
              onClick={() => {
                setDraft(replaceAsk)
                setReplaceAsk(null)
                setMode('review')
              }}
            >
              Review & replace
            </Action>
            <Action
              variant="secondary"
              onClick={() => {
                setReplaceAsk(null)
                setMode('week')
              }}
            >
              Keep current schedule
            </Action>
          </div>
        </div>
      )}

      {mode === 'home' && (
        <div className="grid md:grid-cols-2 gap-5 mt-10">
          <label className="cursor-pointer border-2 border-ink rounded-3xl p-8 hover:shadow-hard hover:-translate-y-1 transition-all">
            <div className="text-xs tracking-widest font-bold">OPTION A</div>
            <div className="text-3xl font-black mt-3">Upload timetable</div>
            <p className="text-muted mt-3">A timetable PDF from Queen’s SOLUS.</p>
            <input
              className="mt-6"
              type="file"
              accept="application/pdf,.pdf"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                void onUpload(file)
              }}
            />
          </label>
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              setEditing(blankEntry())
              setMode('form')
            }}
            onKeyDown={(event) => activate(event, () => { setEditing(blankEntry()); setMode('form') })}
            className="cursor-pointer border-2 border-ink rounded-3xl p-8 hover:shadow-hard hover:-translate-y-1 transition-all"
          >
            <div className="text-xs tracking-widest font-bold">OPTION B</div>
            <div className="text-3xl font-black mt-3">Enter manually</div>
            <p className="text-muted mt-3">Add a course or other commitment by day and time, or fix anything OCR missed.</p>
          </div>
        </div>
      )}

      {mode === 'review' && (
        <section className="mt-8">
          <p className="font-semibold">{layoutNote}</p>
          <div className="flex flex-wrap gap-3 mt-4">
            <Action onClick={confirmDraft}>Save confirmed classes</Action>
            <Action variant="secondary" onClick={() => { setEditing(blankEntry()); setMode('form') }}>
              Add a class
            </Action>
            <Action variant="quiet" onClick={() => setMode(entries.length ? 'week' : 'home')}>
              Cancel
            </Action>
          </div>
          <div className="grid gap-4 mt-6">
            {draft.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onChange={(next) => setDraft((list) => list.map((item) => (item.id === next.id ? next : item)))}
                onDelete={() => setDraft((list) => list.filter((item) => item.id !== entry.id))}
              />
            ))}
          </div>
        </section>
      )}

      {mode === 'week' && (
        <section className="mt-8">
          <div className="flex flex-wrap gap-3">
            <Action variant="secondary" onClick={() => setMode('home')}>
              Upload another PDF
            </Action>
            <Action variant="secondary" onClick={() => { setEditing(blankEntry()); setMode('form') }}>
              Add a class
            </Action>
            <Action
              variant="quiet"
              onClick={() => {
                persist(entries.map((entry) => ({ ...entry, repeatsWeekly: true, startDate: undefined, endDate: undefined })))
                setStatus('These meetings will now be treated as repeating every week.')
              }}
            >
              Repeat weekly
            </Action>
            <Action
              variant="quiet"
              onClick={() => {
                if (storageAvailable()) clearSchedule()
                setEntries([])
                setMode('home')
              }}
            >
              Delete schedule
            </Action>
          </div>
          <WeekList
            entries={entries}
            onEdit={(entry) => {
              setEditing(entry)
              setMode('form')
            }}
            onDelete={(id) => persist(entries.filter((entry) => entry.id !== id))}
          />
          {overlaps.length > 0 && (
            <p className="mt-4 font-semibold">Overlapping classes on this date are listed together — times are not stretched on a fake grid.</p>
          )}
          <div className="mt-10 border-2 border-ink rounded-3xl p-6">
            <div className="text-xs tracking-widest font-bold">FREE PERIODS</div>
            <label className="block mt-4 font-semibold">
              Date (Kingston)
              <input
                type="date"
                className="mt-2 w-full border-2 border-ink rounded-2xl px-4 py-3"
                value={gapDate}
                onChange={(event) => setGapDate(event.target.value)}
              />
            </label>
            {gaps.length === 0 && <p className="mt-4 text-muted">No usable gaps (15+ minutes) on this date.</p>}
            <div className="grid gap-3 mt-4">
              {gaps.map((gap) => (
                <div key={`${gap.startMinute}-${gap.endMinute}`} className="border-2 border-ink rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="font-black">
                      {clockLabel(gap.startMinute)} – {clockLabel(gap.endMinute)}
                    </div>
                    <div className="text-sm text-muted">
                      {gap.minutes} min
                      {gap.fromLocation ? ` · from ${gap.fromLocation}` : ' · before first class'}
                      {gap.toLocation ? ` · until ${gap.toLocation}` : ''}
                    </div>
                  </div>
                  <Action onClick={() => startSearch(gap)}>Find activities during this break</Action>
                </div>
              ))}
            </div>
            {pickGap && gapAuto && gapCopy && (gapAuto.requiresFrom || gapAuto.requiresTo || locationsStatus !== 'ready') && (
              <div className="mt-6 border-t-2 border-ink pt-6">
                <div className="font-black text-xl">Activities that fit this break</div>
                <p className="text-muted mt-2">{gapCopy.help}</p>
                {locationsStatus === 'loading' && (
                  <p className="mt-3 text-muted">Loading campus landmarks…</p>
                )}
                {locationsStatus === 'error' && (
                  <p className="mt-3 font-semibold" role="alert">
                    Campus landmarks could not be loaded from the server. You can still review your schedule, but activity search needs GET /api/locations.{' '}
                    {onReloadLocations && (
                      <button type="button" className="underline" onClick={onReloadLocations}>
                        Try again
                      </button>
                    )}
                  </p>
                )}
                {gapAuto.from.unresolved && gapAuto.hasPreviousClass && gapAuto.from.displayLocation && (
                  <p className="mt-3 font-semibold">
                    “{gapAuto.from.displayLocation}” is not on the walking map. Pick the closest campus landmark for where this break starts.
                  </p>
                )}
                {gapAuto.requiresTo && gapAuto.to.displayLocation && (
                  <p className="mt-3 font-semibold">
                    “{gapAuto.to.displayLocation}” is not on the walking map, so walking time from the activity to class cannot be counted yet. Pick the closest mapped building.
                  </p>
                )}
                <div className={`grid gap-4 mt-4 ${gapAuto.requiresFrom && gapAuto.requiresTo ? 'sm:grid-cols-2' : ''}`}>
                  {gapAuto.requiresFrom && (
                    <LandmarkSelect
                      label={gapCopy.fromLabel}
                      placeholder={gapCopy.fromPlaceholder}
                      value={fromId}
                      places={landmarks}
                      onChange={(id) => {
                        setFromDirty(true)
                        setFromId(id)
                      }}
                    />
                  )}
                  {gapAuto.requiresTo && (
                    <LandmarkSelect
                      label={gapCopy.toLabel}
                      placeholder={gapCopy.toPlaceholder}
                      value={toId}
                      places={landmarks}
                      onChange={(id) => {
                        setToDirty(true)
                        setToId(id)
                      }}
                    />
                  )}
                </div>
                <Action className="mt-4" onClick={runSearch} disabled={landmarks.length === 0 || locationsStatus !== 'ready'}>
                  Search this break
                </Action>
              </div>
            )}
          </div>
        </section>
      )}

      {mode === 'form' && editing && (
        <EntryForm
          entry={editing}
          onCancel={() => setMode(entries.length || draft.length ? (draft.length ? 'review' : 'week') : 'home')}
          onSave={(next) => {
            if (!isComplete(next)) {
              const issues = entryIssues(next)
                .filter((code) => code !== 'missing-location')
                .map(warningLabel)
              setError(
                issues.length
                  ? `Fix before saving: ${issues.join(', ')}.`
                  : 'A class needs a name, at least one weekday, and a start time before the end time.',
              )
              return
            }
            if (draft.length && mode === 'form') {
              setDraft((list) => {
                const exists = list.some((item) => item.id === next.id)
                return exists ? list.map((item) => (item.id === next.id ? next : item)) : [...list, next]
              })
              setMode('review')
              setError('')
              return
            }
            const exists = entries.some((item) => item.id === next.id)
            persist(exists ? entries.map((item) => (item.id === next.id ? next : item)) : [...entries, next])
            setMode('week')
            setError('')
          }}
        />
      )}
    </main>
  )
}

function blankEntry(): ScheduleEntry {
  return normalizeEntry({
    id: newId(),
    title: '',
    days: [],
    startTime: '',
    endTime: '',
    repeatsWeekly: false,
    source: 'manual',
    warnings: [],
    confidence: 'low',
  })
}

function EntryCard({
  entry,
  onChange,
  onDelete,
}: {
  entry: ScheduleEntry
  onChange: (entry: ScheduleEntry) => void
  onDelete: () => void
}) {
  const complete = isComplete(entry)
  const needsReview =
    !complete ||
    entry.warnings.includes('grid-time') ||
    entry.warnings.includes('ocr-mismatch') ||
    entry.confidence !== 'high'
  return (
    <div className={`border-2 border-ink rounded-3xl p-5 ${needsReview ? 'bg-yellow' : 'bg-paper'}`}>
      <div className="flex justify-between gap-3">
        <div className="text-xs tracking-widest font-bold">{needsReview ? 'NEEDS REVIEW' : entry.confidence.toUpperCase()}</div>
        <button type="button" className="font-bold underline" onClick={onDelete}>
          Delete
        </button>
      </div>
      {entry.cropDataUrl && (
        <img src={entry.cropDataUrl} alt="Original class block from the timetable" className="mt-4 max-h-40 border-2 border-ink rounded-2xl bg-paper" />
      )}
      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <Field label="Title" value={entry.title} onChange={(title) => onChange(normalizeEntry({ ...entry, title }))} />
        <Field
          label="Course code"
          value={entry.courseCode ?? ''}
          warn={!entry.courseCode}
          onChange={(courseCode) => onChange(normalizeEntry({ ...entry, courseCode: courseCode || undefined, title: courseCode || entry.title }))}
        />
        <Field label="Section" value={entry.section ?? ''} onChange={(section) => onChange(normalizeEntry({ ...entry, section }))} />
        <Field label="Class type" value={entry.component ?? ''} onChange={(component) => onChange(normalizeEntry({ ...entry, component }))} />
        <Field label="Location" value={entry.location ?? ''} onChange={(location) => onChange(normalizeEntry({ ...entry, location }))} />
        <Field
          label="Start (HH:MM)"
          value={entry.startTime}
          warn={entry.warnings.includes('grid-time') || entry.warnings.includes('ocr-mismatch') || !entry.startTime}
          onChange={(startTime) =>
            onChange(
              normalizeEntry({
                ...entry,
                startTime,
                warnings: entry.warnings.filter((code) => code !== 'grid-time' && code !== 'ocr-mismatch'),
              }),
            )
          }
        />
        <Field
          label="End (HH:MM)"
          value={entry.endTime}
          warn={entry.warnings.includes('grid-time') || entry.warnings.includes('ocr-mismatch') || !entry.endTime}
          onChange={(endTime) =>
            onChange(
              normalizeEntry({
                ...entry,
                endTime,
                warnings: entry.warnings.filter((code) => code !== 'grid-time' && code !== 'ocr-mismatch'),
              }),
            )
          }
        />
        <Field
          label="Date YYYY-MM-DD"
          value={entry.startDate ?? ''}
          onChange={(startDate) => onChange(normalizeEntry({ ...entry, startDate: startDate || undefined, endDate: startDate || undefined }))}
        />
      </div>
      <DayPicker days={entry.days} onChange={(days) => onChange(normalizeEntry({ ...entry, days }))} />
      {entry.warnings.length > 0 && (
        <p className="text-sm mt-3">{entry.warnings.map(warningLabel).join(' · ')}</p>
      )}
    </div>
  )
}

function LandmarkSelect({
  label,
  placeholder,
  value,
  places,
  onChange,
}: {
  label: string
  placeholder: string
  value: string
  places: Location[]
  onChange: (id: string) => void
}) {
  return (
    <label className="font-semibold">
      {label}
      <select
        className="mt-2 w-full border-2 border-ink rounded-2xl px-4 py-3 bg-paper text-ink"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {places.map((place) => (
          <option key={place.id} value={place.id}>
            {place.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function warningLabel(code: string): string {
  const labels: Record<string, string> = {
    'missing-day': 'Missing day',
    'missing-start': 'Missing start time',
    'missing-end': 'Missing end time',
    'ambiguous-ampm': 'Ambiguous AM/PM',
    'unrecognized-layout': 'Unfamiliar layout',
    'missing-location': 'No location',
    'possible-duplicate': 'Possible duplicate',
    'uncertain-grid': 'Uncertain column',
    incomplete: 'Incomplete',
    'missing-course': 'Enter the course code',
    'grid-time': 'Time estimated from the timetable grid — confirm it',
    'ocr-mismatch': 'OCR time disagrees with the grid — confirm it',
    'possible-merge': 'This crop may contain more than one class — split or edit it',
  }
  return labels[code] ?? code
}

function Field({
  label,
  value,
  onChange,
  name,
  warn = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  name?: string
  warn?: boolean
}) {
  return (
    <label className="font-semibold text-sm">
      {label}
      <input
        name={name}
        className={`mt-1 w-full border-2 rounded-2xl px-3 py-2 ${warn ? 'border-red bg-yellow' : 'border-ink'}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function DayPicker({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mt-4">
      {DAY_SHORT.map((label, day) => {
        const on = days.includes(day)
        return (
          <button
            type="button"
            key={label}
            aria-pressed={on}
            data-day={day}
            className={`px-3 py-2 rounded-full border-2 border-ink text-sm font-bold ${on ? 'bg-ink text-paper' : 'bg-paper'}`}
            onClick={() => onChange(on ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b))}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function WeekList({
  entries,
  onEdit,
  onDelete,
}: {
  entries: ScheduleEntry[]
  onEdit: (entry: ScheduleEntry) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="grid gap-4 mt-8">
      {DAY_NAMES.map((name, day) => {
        const ofDay = entries
          .filter((entry) => entry.days.includes(day))
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
        return (
          <div key={name} className="border-2 border-ink rounded-3xl p-5">
            <div className="font-black text-xl">{name}</div>
            {ofDay.length === 0 && <p className="text-muted mt-2">No classes</p>}
            <div className="grid gap-2 mt-3">
              {ofDay.map((entry) => (
                <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-2 border-ink rounded-2xl px-4 py-3">
                  <div>
                    <div className="font-bold">{entry.title}</div>
                    <div className="text-sm text-muted">
                      {entry.startTime}–{entry.endTime}
                      {entry.component ? ` · ${entry.component}` : ''}
                      {entry.location ? ` · ${entry.location}` : ''}
                      {entry.startDate && !entry.repeatsWeekly ? ` · ${entry.startDate}` : ''}
                      {entry.repeatsWeekly ? ' · weekly' : ''}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="font-bold underline" onClick={() => onEdit(entry)}>
                      Edit
                    </button>
                    <button type="button" className="font-bold underline" onClick={() => onDelete(entry.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EntryForm({
  entry,
  onSave,
  onCancel,
}: {
  entry: ScheduleEntry
  onSave: (entry: ScheduleEntry) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(entry)
  const draftRef = useRef(draft)
  const formRef = useRef<HTMLFormElement>(null)
  draftRef.current = draft
  const update = (patch: Partial<ScheduleEntry>) => setDraft((current) => ({ ...current, ...patch }))
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const current = draftRef.current
    const formEl = formRef.current ?? event.currentTarget
    const read = (name: string, fallback = '') =>
      (formEl.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? '').trim() || fallback
    const title = read('title', current.title)
    const location = read('location', current.location ?? '')
    const startRaw = read('startTime', current.startTime)
    const endRaw = read('endTime', current.endTime)
    const component = read('component', current.component ?? '')
    const startDate = read('startDate', current.startDate ?? '')
    const start = parseClock(startRaw)
    const end = parseClock(endRaw)
    const selectedDays = [...formEl.querySelectorAll<HTMLButtonElement>('button[data-day][aria-pressed="true"]')]
      .map((button) => Number(button.dataset.day))
      .filter((day) => day >= 0 && day <= 6)
    onSave(
      normalizeEntry({
        ...current,
        title,
        location: location || undefined,
        component: component || undefined,
        startDate: startDate || undefined,
        days: selectedDays.length ? selectedDays : current.days,
        startTime: start.ok ? formatClock(start.minute) : startRaw,
        endTime: end.ok ? formatClock(end.minute) : endRaw,
        source: current.source,
      }),
    )
  }
  return (
    <form ref={formRef} onSubmit={submit} className="mt-8 border-2 border-ink rounded-super p-6 md:p-10 shadow-hard">
      <div className="font-black text-3xl">Class details</div>
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
        <Field name="title" label="Course or commitment" value={draft.title} onChange={(title) => update({ title })} />
        <Field name="location" label="Location (optional)" value={draft.location ?? ''} onChange={(location) => update({ location })} />
        <Field name="startTime" label="Start (HH:MM or 9:30 AM)" value={draft.startTime} onChange={(startTime) => update({ startTime })} />
        <Field name="endTime" label="End" value={draft.endTime} onChange={(endTime) => update({ endTime })} />
        <Field name="component" label="Component (optional)" value={draft.component ?? ''} onChange={(component) => update({ component })} />
        <Field
          name="startDate"
          label="Start date YYYY-MM-DD (optional)"
          value={draft.startDate ?? ''}
          onChange={(startDate) => update({ startDate: startDate || undefined })}
        />
      </div>
      <p className="mt-4 font-semibold">Days</p>
      <DayPicker days={draft.days} onChange={(days) => update({ days })} />
      <label className="flex items-center gap-2 mt-4 font-semibold">
        <input type="checkbox" checked={draft.repeatsWeekly} onChange={(e) => update({ repeatsWeekly: e.target.checked })} />
        Repeats every week
      </label>
      <div className="flex gap-3 mt-6">
        <Action type="submit">Save</Action>
        <Action variant="secondary" onClick={onCancel}>
          Cancel
        </Action>
      </div>
    </form>
  )
}
