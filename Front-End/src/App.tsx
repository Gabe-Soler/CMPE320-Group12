import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { fetchActivities, fetchLocations, type Activity, type ActivityQuery, type Location } from './api'
import SchedulePage, { type ScheduleSearch } from './SchedulePage'
import { clockLabel, parseClock } from './schedule/time'

type Step = 'home' | 'time' | 'location' | 'results' | 'detail' | 'schedule'

const timeOptions = [15, 30, 45, 60, 90, 120]

function activate(event: KeyboardEvent<HTMLDivElement>, action: () => void) {
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
}: {
  children: ReactNode
  onClick: () => void
  variant?: 'primary' | 'secondary' | 'quiet'
  className?: string
}) {
  const styles = {
    primary: 'bg-ink text-paper border-ink hover:bg-red hover:text-paper',
    secondary: 'bg-paper text-ink border-ink hover:bg-cloud',
    quiet: 'bg-transparent text-ink border-transparent hover:bg-cloud',
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => activate(event, onClick)}
      className={`select-none cursor-pointer border-2 rounded-full px-5 py-3 font-semibold transition-colors flex items-center justify-center gap-2 ${styles[variant]} ${className}`}
    >
      {children}
    </div>
  )
}

function Arrow({ direction = 'right' }: { direction?: 'right' | 'left' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`size-5 fill-none stroke-current stroke-2 ${direction === 'left' ? 'rotate-180' : ''}`}
    >
      <path d="M5 12h14M14 7l5 5-5 5" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-2">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-2">
      <path d="M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2" />
    </svg>
  )
}

function Brand({ onClick }: { onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => activate(event, onClick)}
      className="cursor-pointer select-none flex items-center gap-3"
    >
      <div className="size-10 rounded-full bg-yellow border-2 border-ink flex items-center justify-center font-black text-lg">
        B
      </div>
      <div className="font-black tracking-tight text-xl">Board, I'm Bored</div>
    </div>
  )
}

function Progress({ step }: { step: Step }) {
  const index = step === 'time' ? 1 : step === 'location' ? 2 : 3
  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3].map((item) => (
        <div key={item} className={`h-1.5 w-10 rounded-full ${item <= index ? 'bg-ink' : 'bg-stone'}`} />
      ))}
    </div>
  )
}

function Home({ onStart, onSchedule }: { onStart: () => void; onSchedule: () => void }) {
  return (
    <main className="flex-1 flex items-center justify-center py-16 md:py-24">
      <section className="w-full max-w-4xl text-center">
        <div className="flex justify-center gap-3 mb-9" aria-hidden="true">
          <div className="size-5 rounded-full bg-red border-2 border-ink" />
          <div className="size-5 rounded-full bg-blue border-2 border-ink" />
          <div className="size-5 rounded-full bg-yellow border-2 border-ink" />
        </div>
        <div className="display-text text-6xl sm:text-7xl lg:text-8xl font-black leading-none tracking-tighter">
          Board, I'm Bored
        </div>
        <p className="mx-auto mt-7 text-xl md:text-2xl leading-relaxed max-w-2xl text-muted">
          Find something to do on campus that fits your time and location.
        </p>
        <div className="flex flex-col items-center gap-4 mt-10">
          <Action onClick={onStart} className="text-lg px-8 py-4">
            Find me something to do <Arrow />
          </Action>
          <Action variant="secondary" onClick={onSchedule} className="text-lg px-8 py-4 hover:!bg-red hover:!text-paper">
            My Schedule
          </Action>
          <div className="flex items-center gap-2 text-sm font-medium text-muted">
            <ClockIcon /> Takes less than 30 seconds
          </div>
        </div>
      </section>
    </main>
  )
}

function Finder({
  step,
  time,
  location,
  locations,
  locationsStatus,
  onReloadLocations,
  onTime,
  onLocation,
  onBack,
  onContinue,
  onResults,
}: {
  step: 'time' | 'location'
  time: number
  location: string
  locations: Location[]
  locationsStatus: 'loading' | 'ready' | 'error'
  onReloadLocations: () => void
  onTime: (time: number) => void
  onLocation: (location: string) => void
  onBack: () => void
  onContinue: () => void
  onResults: () => void
}) {
  return (
    <main className="flex-1 flex items-center py-10 md:py-16">
      <div className="w-full max-w-3xl mx-auto">
        <div className="flex justify-between items-center mb-10">
          <Action variant="quiet" onClick={onBack}>
            <Arrow direction="left" /> Back
          </Action>
          <Progress step={step} />
        </div>

        <div className="rounded-super border-2 border-ink bg-paper shadow-hard overflow-hidden">
          <div className="px-6 md:px-12 py-10 md:py-14">
            <div className="text-xs font-bold tracking-widest text-muted">
              QUESTION {step === 'time' ? '01' : '02'} OF 02
            </div>
            <div className="text-4xl md:text-6xl font-black tracking-tight leading-tight mt-3">
              {step === 'time' ? 'How long have you got?' : 'Where are you now?'}
            </div>
            <p className="text-lg text-muted mt-4">
              {step === 'time'
                ? 'Include the time you need to get back to whatever’s next.'
                : 'Pick the closest campus landmark. No precise location needed.'}
            </p>

            {step === 'time' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-9">
                {timeOptions.map((minutes) => (
                  <div
                    role="button"
                    tabIndex={0}
                    key={minutes}
                    onClick={() => onTime(minutes)}
                    onKeyDown={(event) => activate(event, () => onTime(minutes))}
                    className={`cursor-pointer border-2 border-ink rounded-2xl p-5 text-center transition-all ${
                      time === minutes ? 'bg-yellow shadow-hard-sm -translate-y-1' : 'bg-paper hover:bg-cloud'
                    }`}
                  >
                    <div className="text-3xl font-black">{minutes === 120 ? '2+' : minutes}</div>
                    <div className="text-sm font-semibold mt-1">{minutes === 120 ? 'hours' : 'minutes'}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-9">
                <div className="border-2 border-ink rounded-2xl px-5 py-4 flex gap-3 text-muted">
                  <PinIcon />
                  <span>Search campus locations</span>
                </div>
                <div className="grid sm:grid-cols-2 gap-3 mt-4">
                  {locationsStatus === 'loading' && (
                    <div className="text-muted">Loading locations…</div>
                  )}
                  {locationsStatus === 'error' && (
                    <div className="sm:col-span-2 font-semibold">
                      Couldn’t reach the server for campus landmarks.
                      <button type="button" className="ml-2 underline" onClick={onReloadLocations}>
                        Try again
                      </button>
                    </div>
                  )}
                  {locations.map((place) => (
                    <div
                      role="button"
                      tabIndex={0}
                      key={place.id}
                      onClick={() => onLocation(place.id)}
                      onKeyDown={(event) => activate(event, () => onLocation(place.id))}
                      className={`cursor-pointer border-2 border-ink rounded-2xl px-5 py-4 flex items-center justify-between font-bold transition-all ${
                        location === place.id ? 'bg-blue text-paper shadow-hard-sm -translate-y-1' : 'hover:bg-cloud'
                      }`}
                    >
                      <span>{place.name}</span>
                      <span className={`size-5 rounded-full border-2 border-ink ${location === place.id ? 'bg-ink' : ''}`} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="border-t-2 border-ink bg-cloud px-6 md:px-12 py-5 flex justify-between items-center gap-4">
            <div className="text-sm text-muted">
              {step === 'time'
                ? `${time} minutes selected`
                : locations.find((place) => place.id === location)?.name ?? 'Choose a location'}
            </div>
            <Action onClick={step === 'time' ? onContinue : onResults} className="min-w-36">
              {step === 'time' ? 'Continue' : 'Find ideas'} <Arrow />
            </Action>
          </div>
        </div>
      </div>
    </main>
  )
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; activities: Activity[] }

function useActivities(search: ActivityQuery): Load {
  // Each answer is tagged with the search it belongs to, so a new search shows "loading"
  // until its own answer arrives instead of briefly showing the previous one.
  const key = JSON.stringify(search)
  const [answer, setAnswer] = useState<{ key: string; load: Load } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchActivities(search.minutes, search.locationId, controller.signal, search)
      .then((activities) => setAnswer({ key, load: { status: 'ready', activities } }))
      .catch((error: Error) => {
        if (!controller.signal.aborted) setAnswer({ key, load: { status: 'error', message: error.message } })
      })
    return () => controller.abort()
  }, [key, search])

  return answer?.key === key ? answer.load : { status: 'loading' }
}

function windowLabel(search: ActivityQuery): string | undefined {
  if (!search.at || !search.until) return undefined
  const start = parseClock(search.at.slice(search.at.indexOf('T') + 1), true)
  const end = parseClock(search.until, true)
  if (!start.ok || !end.ok) return undefined
  return `${clockLabel(start.minute)} – ${clockLabel(end.minute)}`
}

function planTimes(activity: Activity, search: ActivityQuery) {
  const start = parseClock(activity.startsAt, true)
  if (!start.ok) return undefined
  const done = start.minute + activity.duration
  const atClass = done + (activity.walkAfter ?? 0)
  return {
    start: clockLabel(start.minute),
    done: clockLabel(done),
    atClass: search.destinationId ? clockLabel(atClass) : undefined,
  }
}

function Results({
  search,
  locationName,
  onEdit,
  onSelect,
}: {
  search: ActivityQuery
  locationName: string
  onEdit: () => void
  onSelect: (activity: Activity) => void
}) {
  const load = useActivities(search)
  const activities = load.status === 'ready' ? load.activities : []
  const time = search.minutes
  const breakWindow = windowLabel(search)

  return (
    <main className="flex-1 py-10 md:py-14">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="text-xs font-bold tracking-widest">
            {load.status === 'ready' && activities.length > 0 ? 'GOOD NEWS' : 'YOUR SEARCH'}
          </div>
          <div className="text-4xl md:text-6xl font-black tracking-tight mt-2">
            {load.status === 'loading' && 'Finding ideas…'}
            {load.status === 'error' && 'Something went wrong.'}
            {load.status === 'ready' && (activities.length > 0 ? 'You’ve got options.' : 'Nothing fits right now.')}
          </div>
          <p className="text-muted text-lg mt-3">
            {load.status === 'error'
              ? `Couldn’t reach the server: ${load.message}`
              : load.status === 'ready' && activities.length === 0
                ? 'Try giving yourself more time or picking “Anywhere”.'
                : search.scheduleAware
                  ? search.destinationId
                    ? 'Only ideas that fit this break, including walking time from the activity to class and a 5-minute arrival buffer.'
                    : 'Only ideas that fit this break. There is no next class, so walking time is one-way — not a return trip.'
                  : 'Ranked for your time, distance, and what’s open now.'}
          </p>
        </div>
        <Action variant="secondary" onClick={onEdit}>
          Change my search
        </Action>
      </div>

      <div className="flex flex-wrap gap-2 mt-8 pb-7 border-b-2 border-ink">
        <div className="rounded-full bg-ink text-paper px-4 py-2 text-sm font-bold flex gap-2">
          <ClockIcon /> {breakWindow ?? `${time} minutes`}
        </div>
        <div className="rounded-full border-2 border-ink px-4 py-2 text-sm font-bold flex gap-2">
          <PinIcon /> {locationName}
        </div>
        <div className="rounded-full border-2 border-ink px-4 py-2 text-sm font-bold">Free</div>
        <div className="rounded-full border-2 border-dashed border-stone px-4 py-2 text-sm font-bold text-muted">
          + Add filters
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mt-8">
        {activities.map((activity, index) => {
          const plan = planTimes(activity, search)
          return (
          <div
            key={activity.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(activity)}
            onKeyDown={(event) => activate(event, () => onSelect(activity))}
            className="cursor-pointer group border-2 border-ink rounded-3xl bg-paper p-6 hover:shadow-hard hover:-translate-y-1 transition-all"
          >
            <div className="flex justify-between gap-4">
              <div
                className={`text-xs tracking-widest font-bold ${index === 0 ? 'bg-yellow' : 'bg-cloud'} rounded-full px-3 py-1.5`}
              >
                {index === 0 ? 'BEST MATCH' : activity.category}
              </div>
              <div className="size-10 border-2 border-ink rounded-full flex items-center justify-center group-hover:bg-ink group-hover:text-paper transition-colors">
                <Arrow />
              </div>
            </div>
            <div className="text-2xl font-black mt-6">{activity.name}</div>
            <div className="text-muted mt-2">{activity.description}</div>
            {plan && (
              <p className="mt-3 font-semibold">
                {plan.start} – {plan.done}
                {plan.atClass ? ` · at class by ${plan.atClass}` : ''}
              </p>
            )}
            <div className="grid grid-cols-3 border-t-2 border-ink mt-6 pt-4 text-sm">
              <div>
                <span className="text-muted">Activity</span>
                <div className="font-bold mt-1">{activity.duration} min</div>
              </div>
              <div>
                <span className="text-muted">Walk</span>
                <div className="font-bold mt-1">{activity.walk} min</div>
              </div>
              <div>
                <span className="text-muted">Where</span>
                <div className="font-bold mt-1 truncate">{activity.place}</div>
              </div>
            </div>
          </div>
          )
        })}
      </div>
    </main>
  )
}

function Detail({ activity, onBack }: { activity: Activity; onBack: () => void }) {
  const start = parseClock(activity.startsAt, true)
  const plan = start.ok
    ? {
        range: `${clockLabel(start.minute)} – ${clockLabel(start.minute + activity.duration)}`,
        atClass:
          activity.walkAfter && activity.walkAfter !== activity.walk
            ? clockLabel(start.minute + activity.duration + activity.walkAfter)
            : undefined,
      }
    : undefined
  return (
    <main className="flex-1 py-10 md:py-14">
      <Action variant="quiet" onClick={onBack} className="w-fit mb-7">
        <Arrow direction="left" /> All ideas
      </Action>
      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 border-2 border-ink rounded-super bg-paper overflow-hidden shadow-hard">
          <div className="h-64 md:h-80 bg-yellow gallery-lines border-b-2 border-ink flex items-end p-7">
            <div className="bg-paper border-2 border-ink rounded-full px-4 py-2 text-xs tracking-widest font-bold">
              {activity.category}
            </div>
          </div>
          <div className="p-7 md:p-10">
            <div className="text-4xl md:text-6xl font-black tracking-tight">{activity.name}</div>
            <p className="text-lg text-muted leading-relaxed mt-5">{activity.description}</p>
            <div className="border-t-2 border-ink mt-8 pt-7">
              <div className="text-xs tracking-widest font-bold">WHY IT FITS</div>
              <p className="mt-3 leading-relaxed">{activity.reason}</p>
            </div>
          </div>
        </div>
        <aside className="lg:col-span-2">
          <div className="border-2 border-ink rounded-3xl p-6 bg-blue text-paper lg:sticky lg:top-6">
            <div className="text-xs tracking-widest font-bold">YOUR PLAN</div>
            <div className="space-y-5 mt-6">
              <div className="flex gap-3">
                <ClockIcon />
                <div>
                  <div className="font-bold">{activity.total} minutes total</div>
                  <div className="text-sm text-muted">
                    {plan ? `${plan.range}${plan.atClass ? ` · at class by ${plan.atClass}` : ''}` : activity.availability}
                  </div>
                  <div className="text-sm text-muted">
                    {activity.duration} min activity
                    {activity.walkAfter !== undefined && activity.walkAfter !== activity.walk
                      ? ` · ${activity.walk} min there · ${activity.walkAfter} min to class`
                      : ` · ${activity.walk} min walk each way`}
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <PinIcon />
                <div>
                  <div className="font-bold">{activity.place}</div>
                  <div className="text-sm text-muted">{activity.availability}</div>
                </div>
              </div>
            </div>
            <Action onClick={() => undefined} className="w-full mt-7">
              Let’s go <Arrow />
            </Action>
            <div className="text-center text-xs text-muted mt-4">Directions are a future feature</div>
          </div>
        </aside>
      </div>
    </main>
  )
}

export default function App() {
  const [step, setStep] = useState<Step>('home')
  const [time, setTime] = useState(45)
  const [locations, setLocations] = useState<Location[]>([])
  const [locationsStatus, setLocationsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [location, setLocation] = useState('')
  const [selected, setSelected] = useState<Activity | null>(null)
  const [search, setSearch] = useState<ActivityQuery>({ minutes: 45, locationId: '' })
  const [resultsFrom, setResultsFrom] = useState<'finder' | 'schedule'>('finder')

  const [locationReload, setLocationReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 5000)
    setLocationsStatus('loading')
    fetchLocations(controller.signal)
      .then((loaded) => {
        if (cancelled) return
        setLocations(loaded)
        setLocation((current) => current || loaded.find((place) => place.id !== 'anywhere')?.id || loaded[0]?.id || '')
        setLocationsStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setLocationsStatus('error')
      })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [locationReload])

  const goHome = () => setStep('home')
  const locationName = locations.find((place) => place.id === location)?.name ?? ''

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col">
      <header className="border-b-2 border-ink">
        <div className="shell h-20 flex items-center justify-between">
          <Brand onClick={goHome} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-sm font-bold underline-offset-4 hover:underline"
              onClick={() => setStep('schedule')}
            >
              My Schedule
            </button>
            <div className="hidden sm:block text-sm font-semibold text-muted">Made for campus downtime</div>
            <div className="size-2 rounded-full bg-red border border-ink" />
          </div>
        </div>
      </header>

      <div className="shell flex-1 flex flex-col">
        {step === 'home' && <Home onStart={() => setStep('time')} onSchedule={() => setStep('schedule')} />}
        {step === 'schedule' && (
          <SchedulePage
            locations={locations}
            locationsStatus={locationsStatus}
            onReloadLocations={() => setLocationReload((n) => n + 1)}
            onBack={goHome}
            onFind={(next: ScheduleSearch) => {
              setSearch(next)
              setLocation(next.locationId)
              setTime(next.minutes)
              setResultsFrom('schedule')
              setStep('results')
            }}
          />
        )}
        {(step === 'time' || step === 'location') && (
          <Finder
            step={step}
            time={time}
            location={location}
            locations={locations}
            locationsStatus={locationsStatus}
            onReloadLocations={() => setLocationReload((n) => n + 1)}
            onTime={setTime}
            onLocation={setLocation}
            onBack={() => setStep(step === 'time' ? 'home' : 'time')}
            onContinue={() => setStep('location')}
            onResults={() => {
              if (!location) return
              setSearch({ minutes: time, locationId: location })
              setResultsFrom('finder')
              setStep('results')
            }}
          />
        )}
        {step === 'results' && (
          <Results
            search={search}
            locationName={locations.find((place) => place.id === search.locationId)?.name ?? locationName}
            onEdit={() => setStep(resultsFrom === 'schedule' ? 'schedule' : 'time')}
            onSelect={(activity) => {
              setSelected(activity)
              setStep('detail')
            }}
          />
        )}
        {step === 'detail' && selected && <Detail activity={selected} onBack={() => setStep('results')} />}
      </div>

      <footer className="border-t-2 border-ink mt-auto">
        <div className="shell py-5 text-xs font-semibold text-muted flex justify-between">
          <span>Board, I'm Bored</span>
          <span>INTERACTIVE WIREFRAME · V1</span>
        </div>
      </footer>
    </div>
  )
}
