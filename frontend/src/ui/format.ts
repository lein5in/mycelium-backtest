export function rangeHint(min?: number | null, max?: number | null, step?: number | null): string | null {
  if (min === null || min === undefined || max === null || max === undefined) return null
  const stepText = step ? ` · step ${step}` : ''
  return `${min} to ${max}${stepText}`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export function checkFile(file: File, maxBytes: number): string | null {
  if (file.size > maxBytes) {
    return `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)}. Split the file or shorten its period.`
  }
  if (file.size === 0) return `${file.name} is empty.`
  return null
}

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`
export const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`
