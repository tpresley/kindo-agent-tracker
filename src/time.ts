/**
 * Time formatting utilities with timezone support.
 * Reads the user's timezone preference from localStorage.
 */

const STORAGE_KEY = 'kindo-tracker-timezone'

/** Get the user's preferred timezone, or the browser default. */
export function getTimezone(): string {
  if (typeof window === 'undefined') return 'UTC'
  return localStorage.getItem(STORAGE_KEY) || Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Save the user's timezone preference. Empty string clears (uses browser default). */
export function saveTimezone(tz: string) {
  if (tz) {
    localStorage.setItem(STORAGE_KEY, tz)
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

/** Format an ISO timestamp as a short date+time in the user's timezone. */
export function formatTime(iso: string): string {
  const tz = getTimezone()
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: tz,
  })
}

/** Format an ISO timestamp as a relative time (e.g., "5m ago"). */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

/** Format duration between two ISO timestamps. */
export function formatDuration(start: string, end: string | null): string {
  if (!end) return 'running...'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return '<1s'
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

/** Format last-fetched time for the header. */
export function formatLastFetched(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 10) return 'Just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const tz = getTimezone()
  return new Date(iso).toLocaleTimeString(undefined, { timeZone: tz })
}

/** Get a list of common timezone options. */
export function getTimezoneOptions(): { value: string; label: string }[] {
  const zones = [
    'UTC',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Anchorage', 'Pacific/Honolulu',
    'America/Toronto', 'America/Vancouver',
    'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam',
    'Europe/Helsinki', 'Europe/Moscow',
    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok',
    'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
    'Australia/Sydney', 'Australia/Perth',
    'Pacific/Auckland',
  ]

  const now = new Date()
  return zones.map(tz => {
    try {
      const short = now.toLocaleString('en-US', { timeZone: tz, timeZoneName: 'short' }).split(', ').pop() || ''
      const offset = short.split(' ').pop() || ''
      const city = tz.split('/').pop()!.replace(/_/g, ' ')
      return { value: tz, label: `${city} (${offset})` }
    } catch {
      return { value: tz, label: tz }
    }
  })
}
