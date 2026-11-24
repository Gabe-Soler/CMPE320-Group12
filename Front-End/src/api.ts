// Client for the C++ back-end. In development Vite proxies /api to localhost:8080
// (see vite.config.ts); in production the same server serves the page and the API.

export type Location = {
  id: string
  name: string
  notes?: string
}

export type Activity = {
  id: number
  name: string
  category: string
  description: string
  place: string
  lat: number
  lng: number
  duration: number
  walk: number
  walkAfter?: number
  wait: number
  startsAt: string
  total: number
  cost: '' | 'free' | '$' | '$$'
  availability: string
  reason: string
}

export type ActivityQuery = {
  minutes: number
  locationId: string
  at?: string
  destinationId?: string
  until?: string
  buffer?: number
  scheduleAware?: boolean
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
  extra: Omit<ActivityQuery, 'minutes' | 'locationId'> = {},
): Promise<Activity[]> {
  const params = new URLSearchParams({ minutes: String(minutes), location: locationId })
  if (extra.at) params.set('at', extra.at)
  if (extra.destinationId) params.set('destination', extra.destinationId)
  if (extra.until) params.set('until', extra.until)
  if (extra.buffer !== undefined) params.set('buffer', String(extra.buffer))
  const body = await getJson<{ activities: Activity[] }>(`/api/activities?${params}`, signal)
  return body.activities
}
