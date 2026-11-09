// Client for the C++ back-end. In development Vite proxies /api to localhost:8080
// (see vite.config.ts); in production the same server serves the page and the API.

export type Location = {
  id: string
  name: string
}

export type Activity = {
  id: number
  name: string
  category: string
  description: string
  place: string
  lat: number
  lng: number
  duration: number // minutes at the activity
  walk: number // minutes, one way
  wait: number // minutes between arriving and starting
  startsAt: string // "HH:MM", 24-hour local time
  total: number // walk there + wait + activity + walk back
  cost: '' | 'free' | '$' | '$$'
  availability: string // e.g. "Open until 5 PM", "Starts at 7:30 PM"
  reason: string // "Why it fits" sentence
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed (${response.status})`)
  }
  return body as T
}

export async function fetchLocations(signal?: AbortSignal): Promise<Location[]> {
  const body = await getJson<{ locations: Location[] }>('/api/locations', signal)
  return body.locations
}

export async function fetchActivities(
  minutes: number,
  locationId: string,
  signal?: AbortSignal,
): Promise<Activity[]> {
  const params = new URLSearchParams({ minutes: String(minutes), location: locationId })
  const body = await getJson<{ activities: Activity[] }>(`/api/activities?${params}`, signal)
  return body.activities
}
