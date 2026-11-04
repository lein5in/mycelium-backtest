import { useCallback, useEffect, useRef, useState } from 'react'
import { readTheme, withAlpha } from '../../theme/tokens'
import { finalFrame, INTRO_MS, introFrame, introLayout, WORDMARK, type IntroFrame, type IntroLayout } from '../crawler/intro'
import { browserSession, decideIntro, type IntroDecision } from './introGate'
import { setIntroPlaying } from './introState'

export const REDUCED_MOTION_MS = 300
const LEAVE_MS = 200
const BUCKETS = 4

declare global {
  interface Window {
    __introFrames?: number[]
  }
}

type IntroProps = {
  search?: string
  storage?: () => Pick<Storage, 'getItem' | 'setItem'> | null
  reducedMotion?: boolean
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function draw(context: CanvasRenderingContext2D, frame: IntroFrame, layout: IntroLayout, colours: Record<string, string>, width: number, height: number) {
  context.clearRect(0, 0, width, height)
  const centre = layout.targets[0] ?? { x: width / 2, y: height / 2 }
  context.save()
  context.translate(centre.x, centre.y)
  context.scale(frame.markScale, frame.markScale)
  context.translate(-centre.x, -centre.y)
  context.lineCap = 'round'
  for (let bucket = 0; bucket < BUCKETS; bucket += 1) {
    const low = bucket / BUCKETS
    const high = (bucket + 1) / BUCKETS
    const links = frame.links.filter((link) => link.alpha > low && link.alpha <= high)
    if (links.length === 0) continue
    context.beginPath()
    for (const link of links) {
      const a = frame.nodes[link.a]
      const b = frame.nodes[link.b]
      if (!a || !b) continue
      context.moveTo(a.x, a.y)
      context.lineTo(b.x, b.y)
    }
    const alpha = (low + high) / 2
    context.strokeStyle = withAlpha(colours.violet ?? '#7b5cc4', alpha * 0.25)
    context.lineWidth = 3.2
    context.stroke()
    context.strokeStyle = withAlpha(colours.core ?? '#eef1f6', alpha * 0.7)
    context.lineWidth = 0.9
    context.stroke()
  }
  context.beginPath()
  for (const node of frame.nodes) {
    if (node.alpha <= 0.01) continue
    context.moveTo(node.x + node.radius, node.y)
    context.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
  }
  const nodeAlpha = frame.nodes[0]?.alpha ?? 0
  context.fillStyle = withAlpha(colours.violetText ?? '#a58be0', nodeAlpha)
  context.fill()
  context.restore()
}

export function Intro({ search, storage = browserSession, reducedMotion }: IntroProps) {
  const [decision] = useState<IntroDecision>(() =>
    decideIntro(search ?? (typeof window === 'undefined' ? '' : window.location.search), storage),
  )
  const [reduced] = useState(() => reducedMotion ?? prefersReducedMotion())
  const [phase, setPhase] = useState<'playing' | 'leaving' | 'gone'>(decision.show ? 'playing' : 'gone')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const wordRef = useRef<HTMLSpanElement>(null)
  const subRef = useRef<HTMLSpanElement>(null)

  const skip = useCallback(() => setPhase((current) => (current === 'playing' ? 'leaving' : current)), [])

  useEffect(() => {
    if (phase !== 'playing') return
    const onKey = () => skip()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, skip])

  useEffect(() => {
    setIntroPlaying(phase !== 'gone')
    return () => setIntroPlaying(false)
  }, [phase])

  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = setTimeout(() => setPhase('gone'), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'playing') return
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      const timer = setTimeout(() => setPhase('gone'), REDUCED_MOTION_MS)
      return () => clearTimeout(timer)
    }
    const theme = readTheme()
    const colours = { violet: theme.violet, violetText: theme['violet-text'], core: theme['node-core'] }
    const width = window.innerWidth
    const height = window.innerHeight
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const layout = introLayout(decision.seed, width, height)
    const frames: number[] = []
    if (decision.forced) window.__introFrames = frames
    const started = performance.now()
    let last = started
    let request = 0

    const show = (frame: IntroFrame) => {
      draw(context, frame, layout, colours, width, height)
      if (overlayRef.current) overlayRef.current.style.opacity = String(frame.overlay)
      if (wordRef.current) {
        wordRef.current.textContent = WORDMARK.slice(0, frame.letters)
        wordRef.current.style.letterSpacing = `${frame.tracking}em`
      }
      if (subRef.current) subRef.current.style.opacity = String(frame.subtitle)
    }

    if (reduced) {
      show(finalFrame(layout))
      const timer = setTimeout(() => setPhase('gone'), REDUCED_MOTION_MS)
      return () => clearTimeout(timer)
    }
    if (decision.frozenAt !== null) {
      show(introFrame(layout, decision.frozenAt))
      return undefined
    }
    const tick = (now: number) => {
      frames.push(now - last)
      last = now
      const elapsed = now - started
      show(introFrame(layout, elapsed))
      if (elapsed >= INTRO_MS) {
        setPhase('gone')
        return
      }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [phase, decision, reduced])

  if (phase === 'gone') return null
  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      data-testid="intro"
      onPointerDown={skip}
      className={`fixed inset-0 z-[100] bg-app transition-opacity duration-200 ${phase === 'leaving' ? 'pointer-events-none !opacity-0' : 'cursor-pointer'}`}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <span className="absolute inset-x-0 top-[calc(42%+16vmin)] flex flex-col items-center gap-2">
        <span ref={wordRef} className="min-h-[1.2em] font-mono text-[22px] font-semibold text-ink sm:text-[28px]" />
        <span ref={subRef} className="text-[16px] text-ink-2 opacity-0">
          Backtest
        </span>
      </span>
      <span className="absolute right-4 bottom-4 font-mono text-[11px] text-ink-3">Press any key or click to skip</span>
    </div>
  )
}
