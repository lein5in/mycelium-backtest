import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = resolve(ROOT, process.argv[2] ?? 'dist')
const port = Number(process.env.PORT ?? 5417)
const config = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8'))
const rewrites = (config.rewrites ?? []).map((rule) => ({ pattern: new RegExp(`^${rule.source}$`), destination: rule.destination }))
const headerRules = (config.headers ?? []).map((rule) => ({ pattern: new RegExp(`^${rule.source}$`), headers: rule.headers }))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function resolveFile(pathname) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
  const candidate = join(directory, safe)
  if (!candidate.startsWith(directory)) return null
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  for (const rule of rewrites) {
    if (rule.pattern.test(pathname)) return join(directory, rule.destination)
  }
  return null
}

createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  const file = resolveFile(pathname)
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
    return
  }
  const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }
  for (const rule of headerRules) {
    if (!rule.pattern.test(pathname)) continue
    for (const header of rule.headers) headers[header.key.toLowerCase()] = header.value
  }
  response.writeHead(200, headers)
  createReadStream(file).pipe(response)
}).listen(port, '127.0.0.1', () => console.log(`serving ${directory} on http://localhost:${port}`))
