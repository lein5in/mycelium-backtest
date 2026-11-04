import type { RunRequestDocument, RunResultPayload } from '../../api/result'
import type { Verdict } from '../../api/runEvents'

export const RESULT_CAP_BYTES = 3 * 1024 * 1024

export type HistoryStatus = 'running' | 'done' | 'failed' | 'cancelled'

export type HistoryEntry = {
  id: string
  savedAt: string
  kind: 'provider' | 'csv'
  request: RunRequestDocument
  strategyName: string
  market: string
  symbol: string
  timeframe: string | null
  sourceMode: string | null
  status: HistoryStatus
  verdict: Verdict | null
  netPnl: number | null
  tradeCount: number | null
  resultBytes: number | null
  resultNote: string | null
}

export type HistoryBackend = {
  list: () => Promise<HistoryEntry[]>
  get: (id: string) => Promise<HistoryEntry | undefined>
  put: (entry: HistoryEntry) => Promise<void>
  remove: (id: string) => Promise<void>
  clear: () => Promise<void>
  putResult: (id: string, data: Uint8Array) => Promise<void>
  getResult: (id: string) => Promise<Uint8Array | undefined>
}

export type Codec = {
  encode: (text: string) => Promise<Uint8Array>
  decode: (data: Uint8Array) => Promise<string>
}

export type HistoryProblem = 'unavailable' | 'quota' | 'failed'

export class HistoryError extends Error {
  constructor(
    readonly problem: HistoryProblem,
    message: string,
  ) {
    super(message)
    this.name = 'HistoryError'
  }
}

export const HISTORY_MESSAGES: Record<HistoryProblem, string> = {
  unavailable:
    'History is not available in this browser (storage is blocked or disabled). Runs still work; they are just not saved.',
  quota: 'This browser has no room left for history. Delete older runs or clear the history, then try again.',
  failed: 'The browser could not save this run to history.',
}

function isQuota(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
}

function wrap(error: unknown): HistoryError {
  if (error instanceof HistoryError) return error
  if (isQuota(error)) return new HistoryError('quota', HISTORY_MESSAGES.quota)
  return new HistoryError('failed', HISTORY_MESSAGES.failed)
}

export const gzipCodec: Codec = {
  encode: async (text) => {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  },
  decode: async (data) => {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Response(stream).text()
  },
}

export function summaryOf(payload: RunResultPayload): Pick<
  HistoryEntry,
  'strategyName' | 'market' | 'symbol' | 'timeframe' | 'sourceMode' | 'verdict' | 'netPnl' | 'tradeCount' | 'status'
> {
  return {
    strategyName: payload.result.strategy,
    market: payload.source.market,
    symbol: payload.source.symbol,
    timeframe: payload.source.timeframe,
    sourceMode: payload.source.mode,
    verdict: payload.report.verdict.id,
    netPnl: payload.result.metrics.summary.net_pnl,
    tradeCount: payload.result.metrics.summary.trade_count,
    status: 'done',
  }
}

export class HistoryStore {
  constructor(
    private readonly open: () => HistoryBackend | null,
    private readonly codec: Codec = gzipCodec,
    readonly capBytes = RESULT_CAP_BYTES,
  ) {}

  private backend: HistoryBackend | null | undefined

  private use(): HistoryBackend {
    if (this.backend === undefined) {
      try {
        this.backend = this.open()
      } catch {
        this.backend = null
      }
    }
    if (!this.backend) throw new HistoryError('unavailable', HISTORY_MESSAGES.unavailable)
    return this.backend
  }

  get available(): boolean {
    try {
      this.use()
      return true
    } catch {
      return false
    }
  }

  async list(): Promise<HistoryEntry[]> {
    try {
      const entries = await this.use().list()
      return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    } catch (error) {
      throw wrap(error)
    }
  }

  async get(id: string): Promise<HistoryEntry | undefined> {
    try {
      return await this.use().get(id)
    } catch (error) {
      throw wrap(error)
    }
  }

  async put(entry: HistoryEntry): Promise<void> {
    try {
      await this.use().put(entry)
    } catch (error) {
      throw wrap(error)
    }
  }

  async update(id: string, change: Partial<HistoryEntry>): Promise<void> {
    const current = await this.get(id)
    if (!current) return
    await this.put({ ...current, ...change })
  }

  async saveResult(entry: HistoryEntry, payload: RunResultPayload): Promise<HistoryEntry> {
    const backend = this.use()
    let data: Uint8Array
    try {
      data = await this.codec.encode(JSON.stringify(payload))
    } catch (error) {
      throw wrap(error)
    }
    const summary = { ...entry, ...summaryOf(payload) }
    if (data.byteLength > this.capBytes) {
      const next = {
        ...summary,
        resultBytes: null,
        resultNote: `The full result (${(data.byteLength / 1_048_576).toFixed(1)} MB compressed) is over the ${(this.capBytes / 1_048_576).toFixed(0)} MB limit for this browser; only the summary is kept.`,
      }
      await this.put(next)
      return next
    }
    try {
      await backend.putResult(entry.id, data)
    } catch (error) {
      const wrapped = wrap(error)
      const next = { ...summary, resultBytes: null, resultNote: wrapped.message }
      await this.put(next).catch(() => undefined)
      throw wrapped
    }
    const next = { ...summary, resultBytes: data.byteLength, resultNote: null }
    await this.put(next)
    return next
  }

  async loadResult(id: string): Promise<RunResultPayload | null> {
    try {
      const data = await this.use().getResult(id)
      if (!data) return null
      return JSON.parse(await this.codec.decode(data)) as RunResultPayload
    } catch (error) {
      if (error instanceof SyntaxError) return null
      throw wrap(error)
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.use().remove(id)
    } catch (error) {
      throw wrap(error)
    }
  }

  async clear(): Promise<void> {
    try {
      await this.use().clear()
    } catch (error) {
      throw wrap(error)
    }
  }
}

const DB_NAME = 'mycelium-history'
const DB_VERSION = 1
const RUNS = 'runs'
const RESULTS = 'results'

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export function indexedDbBackend(factory: IDBFactory | undefined = globalThis.indexedDB): HistoryBackend | null {
  if (!factory) return null
  let database: Promise<IDBDatabase> | null = null
  const connect = () => {
    database ??= new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(RESULTS)) db.createObjectStore(RESULTS)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new DOMException('blocked', 'InvalidStateError'))
    })
    return database
  }
  const write = async (stores: string[], action: (transaction: IDBTransaction) => void) => {
    const db = await connect()
    const transaction = db.transaction(stores, 'readwrite')
    action(transaction)
    await done(transaction)
  }
  return {
    list: async () => promised((await connect()).transaction(RUNS).objectStore(RUNS).getAll() as IDBRequest<HistoryEntry[]>),
    get: async (id) => promised((await connect()).transaction(RUNS).objectStore(RUNS).get(id) as IDBRequest<HistoryEntry | undefined>),
    put: (entry) => write([RUNS], (transaction) => transaction.objectStore(RUNS).put(entry)),
    remove: (id) =>
      write([RUNS, RESULTS], (transaction) => {
        transaction.objectStore(RUNS).delete(id)
        transaction.objectStore(RESULTS).delete(id)
      }),
    clear: () =>
      write([RUNS, RESULTS], (transaction) => {
        transaction.objectStore(RUNS).clear()
        transaction.objectStore(RESULTS).clear()
      }),
    putResult: (id, data) => write([RESULTS], (transaction) => transaction.objectStore(RESULTS).put(data, id)),
    getResult: async (id) =>
      promised((await connect()).transaction(RESULTS).objectStore(RESULTS).get(id) as IDBRequest<Uint8Array | undefined>),
  }
}

export function memoryBackend(): HistoryBackend {
  const runs = new Map<string, HistoryEntry>()
  const results = new Map<string, Uint8Array>()
  return {
    list: async () => [...runs.values()],
    get: async (id) => runs.get(id),
    put: async (entry) => {
      runs.set(entry.id, entry)
    },
    remove: async (id) => {
      runs.delete(id)
      results.delete(id)
    },
    clear: async () => {
      runs.clear()
      results.clear()
    },
    putResult: async (id, data) => {
      results.set(id, data)
    },
    getResult: async (id) => results.get(id),
  }
}

export const history = new HistoryStore(() => {
  try {
    return indexedDbBackend()
  } catch {
    return null
  }
})

export function entryFromRequest(
  id: string,
  request: RunRequestDocument,
  labels: { strategyName: string; market: string; sourceMode: string | null },
  now: Date = new Date(),
): HistoryEntry {
  const kind = request.data ? 'provider' : 'csv'
  return {
    id,
    savedAt: now.toISOString(),
    kind,
    request,
    strategyName: labels.strategyName,
    market: labels.market,
    symbol: request.data?.symbol ?? 'CSV file',
    timeframe: request.data?.timeframe ?? request.csv?.timeframe ?? null,
    sourceMode: labels.sourceMode,
    status: 'running',
    verdict: null,
    netPnl: null,
    tradeCount: null,
    resultBytes: null,
    resultNote: null,
  }
}
