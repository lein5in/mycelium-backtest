const BUCKET_SECONDS = 900

export function anchorMinutes(anchor: string | null | undefined): number {
  const match = /^(\d{2}):(\d{2})$/.exec(anchor ?? '')
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0
}

export function sessionDateFormatter(timeZone: string): (seconds: number) => string {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  return (seconds) => format.format(new Date(seconds * 1000))
}

export function lastBarOfSessions(
  times: readonly number[],
  timeZone: string,
  anchor: string | null | undefined,
): Map<string, number> {
  const shift = anchorMinutes(anchor) * 60
  const dateOf = sessionDateFormatter(timeZone)
  const cache = new Map<number, string>()
  const last = new Map<string, number>()
  for (const time of times) {
    const shifted = time - shift
    const bucket = Math.floor(shifted / BUCKET_SECONDS)
    let date = cache.get(bucket)
    if (date === undefined) {
      date = dateOf(shifted)
      cache.set(bucket, date)
    }
    last.set(date, time)
  }
  return last
}
