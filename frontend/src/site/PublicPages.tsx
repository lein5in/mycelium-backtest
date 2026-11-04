import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Tag } from '../ui/Tag'
import { AVAILABLE_NOW, FUTURE, SOON, TERMS_UPDATED, type RoadmapItem } from './content'
import { DataSourcesContent } from './DataSourcesContent'
import { HOSTED, RUN_LOCALLY_HASH } from './hosted'
import { SiteShell } from './SiteShell'

function Page({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <SiteShell>
      <article className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-4 py-14 sm:px-6">
        <header className="flex flex-col gap-3 border-b border-line pb-6">
          <h1 className="m-0 text-[30px] leading-tight font-semibold text-ink sm:text-[38px]">{title}</h1>
          <div className="max-w-[68ch] text-[15.5px] leading-relaxed text-ink-2">{intro}</div>
        </header>
        {children}
      </article>
    </SiteShell>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 text-[19px] font-semibold text-ink">{title}</h2>
      <div className="flex max-w-[68ch] flex-col gap-2 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </section>
  )
}

export function PrivacyPage() {
  return (
    <Page title="Privacy" intro={<p className="m-0">What Mycelium Backtest keeps, where, and for how long. Each statement describes what the code does today.</p>}>
      <Section title="No account, no tracking">
        <p className="m-0">There are no user accounts. There is no tracking, no analytics, no advertising and no cookies. The pages load no third-party scripts, fonts or images.</p>
      </Section>
      {HOSTED ? <HostedPrivacySections /> : <LivePrivacySections />}
    </Page>
  )
}

function HostedPrivacySections() {
  return (
    <>
      <Section title="This site runs no engine">
        <p className="m-0">The engine is not hosted on this site. It receives no CSV file, no strategy and no run request, and it stores no result. Nothing you type on these pages is sent to a server of ours.</p>
      </Section>
      <Section title="What stays in your browser">
        <p className="m-0">The opening animation remembers in this tab’s session storage that it was shown. If you run Mycelium on your own machine, your acceptance of the terms and your run history are stored in that browser on that machine, and nowhere else.</p>
      </Section>
      <Section title="Hosting logs">
        <p className="m-0">The hosting provider that serves these pages may keep standard server logs, such as the address of the visitor and the page requested. We add no analytics and do not read these logs to track anyone.</p>
      </Section>
      <Section title="When you run it on your machine">
        <p className="m-0">A local installation processes everything on your computer. An imported CSV file stays in memory and is discarded after the run. Public crypto candles are requested from the exchange you choose and may be cached on your own disk. None of it is sent to us.</p>
      </Section>
    </>
  )
}

function LivePrivacySections() {
  return (
    <>
      <Section title="What stays in your browser">
        <p className="m-0">Your acceptance of the terms is stored in this browser’s local storage. Your run history is stored in this browser’s IndexedDB: the settings of each run, a summary, and the full result when it fits under 3 MB. The opening animation remembers in session storage that it was shown. None of this is sent anywhere, and you can delete the history from the History page.</p>
      </Section>
      <Section title="Imported CSV files">
        <p className="m-0">A CSV file you import is sent to the server, processed in memory inside a short-lived process to produce your result, and then discarded. It is never written to disk, never logged and never kept. The file is not stored in your browser history either; running it again asks for the file again.</p>
      </Section>
      <Section title="Run results on the server">
        <p className="m-0">The settings, the events and the result of a run stay in the server’s memory for about 30 minutes, so the run and results screens can load them, and are then purged. Nothing is stored in a database.</p>
      </Section>
      <Section title="Limits and logs">
        <p className="m-0">To share the engine fairly, the server counts runs and requests per IP address. These counters are kept in memory only, under a keyed hash rather than the address itself, and disappear when the server restarts. The application does not write IP addresses to its logs. The hosting provider may keep its own standard server logs.</p>
      </Section>
      <Section title="Market data">
        <p className="m-0">Public crypto candles fetched from exchanges may be cached on the server’s disk for a limited time so the same request does not reach the exchange twice. This cache holds market data only, nothing about you.</p>
      </Section>
    </>
  )
}

export function TermsPage() {
  return (
    <Page
      title="Terms of use"
      intro={
        <>
          <p className="m-0">Plain-language terms for using Mycelium Backtest.</p>
          <p className="mt-2 mb-0 font-mono text-[13px] text-ink-3">Last updated {TERMS_UPDATED}</p>
        </>
      }
    >
      {HOSTED && (
        <Section title="What this site is">
          <p className="m-0">This site presents the project and a recorded run on synthetic sample data. It does not run the engine and it does not accept files. You can run the software on your own machine; the steps are on the home page.</p>
        </Section>
      )}
      <Section title="A research tool">
        <p className="m-0">Mycelium Backtest describes how a set of rules behaved on past data. It is not speculative and it is not financial, investment, tax or legal advice. Nothing on it is a recommendation to buy or sell anything.</p>
      </Section>
      <Section title="It can make mistakes">
        <p className="m-0">The engine, the data and the honesty checks can be wrong or incomplete. Past results do not predict future ones, and a credible verdict is not a promise of profit.</p>
      </Section>
      <Section title="No warranty">
        <p className="m-0">The service is provided as it is, without any warranty of accuracy, availability or fitness for a purpose. It may change, slow down or stop at any time.</p>
      </Section>
      <Section title="Data from third parties">
        <p className="m-0">Market data comes from public sources whose own terms apply; each dataset shows its source and a link on the Data sources page. Synthetic sample sets are not real prices. You are responsible for having the right to use any file you import.</p>
      </Section>
      <Section title="Acceptable use and limits">
        {HOSTED ? (
          <p className="m-0">Use the software for your own research. Do not use it to collect market data in bulk or to overload a data provider. Each run has limits on its date range, file size, number of random draws and running time.</p>
        ) : (
          <p className="m-0">Use the service for your own research. Do not try to break it, overload it, get around its limits, or use it to collect market data in bulk. Each run has limits on its date range, file size, number of random draws and running time, and each IP address has limits on runs per hour and at the same time.</p>
        )}
      </Section>
      <Section title="Limitation of liability">
        <p className="m-0">To the extent the law allows, the authors are not liable for any loss or damage arising from the use of the service or from decisions made with it, including trading losses.</p>
      </Section>
      <Section title="Changes">
        <p className="m-0">These terms may change. The date above shows the latest version; using the service after a change means accepting it.</p>
      </Section>
    </Page>
  )
}

export function PublicDataSourcesPage() {
  return (
    <Page
      title="Data sources"
      intro={
        <p className="m-0">
          Where each dataset comes from, how its heatmap is built, and the attribution it carries. For public endpoints we have not
          verified a licence: see each provider’s terms. Heatmaps built from candles spread each candle’s volume over its price range
          and are always labelled ESTIMATED FROM CANDLES.
          {HOSTED && ' This site does not fetch any market data: the sources below are what the software uses when you run it on your own machine.'}
        </p>
      }
    >
      <DataSourcesContent />
    </Page>
  )
}

function RoadmapList({ title, items, soon }: { title: string; items: RoadmapItem[]; soon?: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 flex items-center gap-2 text-[21px] font-semibold text-ink">
        {title}
        {soon && <Tag state="SOON" />}
      </h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((item) => (
          <li key={item.title} className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0">
            <span className="text-[15.5px] font-medium text-ink">{item.title}</span>
            <span className="max-w-[68ch] text-[15px] leading-relaxed text-ink-2">{item.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function RoadmapPage() {
  return (
    <Page
      title="Roadmap"
      intro={
        <p className="m-0">
          What the product does today, what is planned next and what comes later. No dates are promised, and nothing listed under Soon
          or Future releases works yet. {HOSTED ? (
            <>
              <Link className="text-accent-text underline" to={RUN_LOCALLY_HASH}>Run it locally</Link> to use what is available.
            </>
          ) : (
            <>
              <Link className="text-accent-text underline" to="/app">Open the app</Link> to use what is available.
            </>
          )}
        </p>
      }
    >
      <RoadmapList title="Available now" items={AVAILABLE_NOW} />
      <RoadmapList title="Soon" items={SOON} soon />
      <RoadmapList title="Future releases" items={FUTURE} />
    </Page>
  )
}
