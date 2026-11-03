const spokeAngles = [0, 60, 120, 180, 240, 300]

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="20" height="20" viewBox="-10 -10 20 20" aria-hidden="true">
        {spokeAngles.map((angle) => {
          const rad = (angle * Math.PI) / 180
          const x = Math.cos(rad) * 7
          const y = Math.sin(rad) * 7
          return (
            <g key={angle}>
              <line
                x1="0"
                y1="0"
                x2={x}
                y2={y}
                stroke="var(--violet)"
                strokeWidth="1.5"
                strokeLinecap="square"
              />
              <circle cx={x} cy={y} r="1.6" fill="var(--violet-text)" />
            </g>
          )
        })}
        <circle cx="0" cy="0" r="2.4" fill="var(--node-core)" />
      </svg>
      <span className="font-mono text-[13px] font-semibold tracking-[0.2em] text-ink">MYCELIUM</span>
      <span className="text-[13px] text-ink-2">Backtest</span>
    </span>
  )
}
