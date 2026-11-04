import type { CsvPreview, CsvReport } from '../../api/types'

export const CSV_ROLES = ['timestamp', 'open', 'high', 'low', 'close', 'volume'] as const
export type CsvRole = (typeof CSV_ROLES)[number]

export const LISTED_PROBLEMS = 50

export function timezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  const zones = intl.supportedValuesOf?.('timeZone') ?? []
  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}

export function needsTimezone(report: CsvReport | null): boolean {
  return Boolean(report?.problems.some((problem) => problem.code === 'timezone_required'))
}

export function hiddenProblems(report: CsvReport): number {
  return Math.max(0, report.problem_count - report.problems.length)
}

export function mappingOverrides(
  detected: Record<string, string>,
  chosen: Partial<Record<CsvRole, string>>,
): Record<string, string> | null {
  const changes = Object.entries(chosen).filter(([role, column]) => column && detected[role] !== column)
  if (changes.length === 0) return null
  return Object.fromEntries(
    CSV_ROLES.flatMap((role) => {
      const column = chosen[role] ?? detected[role]
      return column ? [[role, column]] : []
    }),
  )
}

export function blocksRun(preview: CsvPreview | null): boolean {
  return !preview || !preview.ok
}

export function period(preview: CsvPreview): string | null {
  if (!preview.start || !preview.end) return null
  return `${preview.start.slice(0, 16).replace('T', ' ')} to ${preview.end.slice(0, 16).replace('T', ' ')} UTC`
}
