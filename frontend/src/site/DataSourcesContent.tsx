import { ModeBadge } from '../ui/Tag'
import { DATA_SOURCES } from './content'
import { HOSTED } from './hosted'

function statusText(status: string) {
  if (!HOSTED) return status
  return status
    .replace('Used in the hosted version.', 'Used when you run Mycelium on your machine. This site does not fetch it.')
    .replace('Off in the hosted version until', 'Off by default in the software until')
    .replace('Never used in the hosted version.', 'Never used by this site, and off by default in the software.')
}

export function DataSourcesContent() {
  return (
    <ul className="m-0 flex list-none flex-col p-0" data-testid="data-sources-list">
      {DATA_SOURCES.map((source) => (
        <li key={source.name} className="flex flex-col gap-2 border-b border-line py-5 last:border-b-0">
          <h2 className="m-0 flex flex-wrap items-center gap-2 text-[18px] font-semibold text-ink">
            {source.name}
            <ModeBadge mode={source.mode} />
          </h2>
          <p className="m-0 max-w-[70ch] text-[14.5px] leading-relaxed text-ink-2">{source.provides}</p>
          <dl className="m-0 grid max-w-[80ch] grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-1 text-[13.5px]">
            <dt className="text-ink-3">Status</dt>
            <dd className="m-0 text-ink-2">{statusText(source.status)}</dd>
            <dt className="text-ink-3">Attribution</dt>
            <dd className="m-0 text-ink-2">{source.attribution}</dd>
            <dt className="text-ink-3">Provider page</dt>
            <dd className="m-0 break-all text-ink-2">
              {source.link ? (
                <a className="text-accent-text underline" href={source.link} rel="noreferrer">
                  {source.link}
                </a>
              ) : (
                'None: no third party involved.'
              )}
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  )
}
