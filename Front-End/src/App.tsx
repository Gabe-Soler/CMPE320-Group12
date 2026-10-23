import { useState, type KeyboardEvent, type ReactNode } from 'react'

type Step = 'home' | 'time' | 'location' | 'results' | 'detail'

type Activity = {
  name: string
  category: string
  place: string
  duration: number
  walk: number
  availability: string
  description: string
}

// Placeholder data from the design; will be replaced by the back-end API.
const activities: Activity[] = [
  {
    name: 'Take a gallery lap',
    category: 'ARTS & CULTURE',
    place: 'Agnes Etherington',
    duration: 25,
    walk: 6,
    availability: 'Open until 5 PM',
    description:
      'Wander through two current exhibitions at your own pace. No booking needed, and admission is free for students.',
  },
  {
    name: 'Shoot some hoops',
    category: 'GET MOVING',
    place: 'ARC Main Gym',
    duration: 30,
    walk: 4,
    availability: 'Drop-in until 3 PM',
    description:
      'A casual drop-in session with equipment available at the front desk. Bring your student card and indoor shoes.',
  },
  {
    name: 'Walk the waterfront',
    category: 'FRESH AIR',
    place: 'Tindall Field',
    duration: 20,
    walk: 3,
    availability: 'Anytime',
    description:
      'Follow the short campus loop toward the lake and back. A simple reset with no equipment or planning required.',
  },
  {
    name: 'Quiet reading break',
    category: 'SLOW DOWN',
    place: 'Stauffer Library',
    duration: 15,
    walk: 7,
    availability: 'Open now',
    description:
      'Find a window seat on the second floor and take a screen-free break with a magazine from the reading shelf.',
  },
]

const timeOptions = [15, 30, 45, 60, 90, 120]
const locationOptions = ['Goodwin Hall', 'Stauffer Library', 'ARC', 'Union Street', 'West Campus', 'Anywhere']

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

function Home({ onStart }: { onStart: () => void }) {
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
  onTime,
  onLocation,
  onBack,
  onContinue,
  onResults,
}: {
  step: 'time' | 'location'
  time: number
  location: string
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
                  {locationOptions.map((place) => (
                    <div
                      role="button"
                      tabIndex={0}
                      key={place}
                      onClick={() => onLocation(place)}
                      onKeyDown={(event) => activate(event, () => onLocation(place))}
                      className={`cursor-pointer border-2 border-ink rounded-2xl px-5 py-4 flex items-center justify-between font-bold transition-all ${
                        location === place ? 'bg-blue text-paper shadow-hard-sm -translate-y-1' : 'hover:bg-cloud'
                      }`}
                    >
                      <span>{place}</span>
                      <span className={`size-5 rounded-full border-2 border-ink ${location === place ? 'bg-ink' : ''}`} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="border-t-2 border-ink bg-cloud px-6 md:px-12 py-5 flex justify-between items-center gap-4">
            <div className="text-sm text-muted">
              {step === 'time' ? `${time} minutes selected` : location || 'Choose a location'}
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

function Results({
  time,
  location,
  onEdit,
  onSelect,
}: {
  time: number
  location: string
  onEdit: () => void
  onSelect: (activity: Activity) => void
}) {
  return (
    <main className="flex-1 py-10 md:py-14">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="text-xs font-bold tracking-widest">GOOD NEWS</div>
          <div className="text-4xl md:text-6xl font-black tracking-tight mt-2">You’ve got options.</div>
          <p className="text-muted text-lg mt-3">Ranked for your time, distance, and what’s open now.</p>
        </div>
        <Action variant="secondary" onClick={onEdit}>
          Change my search
        </Action>
      </div>

      <div className="flex flex-wrap gap-2 mt-8 pb-7 border-b-2 border-ink">
        <div className="rounded-full bg-ink text-paper px-4 py-2 text-sm font-bold flex gap-2">
          <ClockIcon /> {time} minutes
        </div>
        <div className="rounded-full border-2 border-ink px-4 py-2 text-sm font-bold flex gap-2">
          <PinIcon /> {location}
        </div>
        <div className="rounded-full border-2 border-ink px-4 py-2 text-sm font-bold">Free</div>
        <div className="rounded-full border-2 border-dashed border-stone px-4 py-2 text-sm font-bold text-muted">
          + Add filters
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mt-8">
        {activities.map((activity, index) => (
          <div
            key={activity.name}
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
        ))}
      </div>
    </main>
  )
}

function Detail({ activity, onBack }: { activity: Activity; onBack: () => void }) {
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
              <p className="mt-3 leading-relaxed">
                This leaves you a comfortable buffer after travel, so you can enjoy it without watching the clock.
              </p>
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
                  <div className="font-bold">{activity.duration + activity.walk} minutes total</div>
                  <div className="text-sm text-muted">
                    {activity.duration} min activity · {activity.walk} min walk
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
  const [location, setLocation] = useState('Goodwin Hall')
  const [selected, setSelected] = useState<Activity>(activities[0])

  const goHome = () => setStep('home')

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col">
      <header className="border-b-2 border-ink">
        <div className="shell h-20 flex items-center justify-between">
          <Brand onClick={goHome} />
          <div className="hidden sm:flex items-center gap-3">
            <div className="text-sm font-semibold text-muted">Made for campus downtime</div>
            <div className="size-2 rounded-full bg-red border border-ink" />
          </div>
        </div>
      </header>

      <div className="shell flex-1 flex flex-col">
        {step === 'home' && <Home onStart={() => setStep('time')} />}
        {(step === 'time' || step === 'location') && (
          <Finder
            step={step}
            time={time}
            location={location}
            onTime={setTime}
            onLocation={setLocation}
            onBack={() => setStep(step === 'time' ? 'home' : 'time')}
            onContinue={() => setStep('location')}
            onResults={() => setStep('results')}
          />
        )}
        {step === 'results' && (
          <Results
            time={time}
            location={location}
            onEdit={() => setStep('time')}
            onSelect={(activity) => {
              setSelected(activity)
              setStep('detail')
            }}
          />
        )}
        {step === 'detail' && <Detail activity={selected} onBack={() => setStep('results')} />}
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
