export const RESULT_TABS = ['report', 'chart', 'trades', 'calendar', 'sweep'] as const
export type ResultTab = (typeof RESULT_TABS)[number]

export function tabFromSearch(value: string | null): ResultTab {
  return RESULT_TABS.includes(value as ResultTab) ? (value as ResultTab) : 'report'
}
