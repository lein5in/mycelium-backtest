import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { RunEvent } from '../../api/runEvents'
import { readTheme, type Theme } from '../../theme/tokens'
import { CrawlerEventQueue } from './adapter'
import {
  createModel,
  failRun,
  finishRun,
  moveSpiderTo,
  pulseNode,
  setAggression,
  setAnchors,
  setBeam,
  setParams,
  setStageProgress,
  setTempo,
  startRun,
  stepModel,
  wrapRegion,
  type CrawlerModel,
} from './model'
import { DEFAULT_PARAMS, type CrawlerParams } from './params'
import { CrawlerRenderer } from './renderer'
import type { CrawlerHandle, CrawlerLayout, CrawlerMeasure, WrapRegion } from './types'

export type CrawlerEventSource = (listener: (event: RunEvent) => void) => () => void

export type CrawlerDebug = { model: CrawlerModel; renderer: CrawlerRenderer; measure: CrawlerMeasure | null }

type CrawlerProps = {
  layout: CrawlerLayout | null
  reducedMotion: boolean
  seed?: number
  params?: CrawlerParams
  theme?: Theme
  events?: CrawlerEventSource
  resolveRegion?: (region: WrapRegion) => WrapRegion
  onDebug?: (debug: CrawlerDebug) => void
  ref?: Ref<CrawlerHandle>
}

export function Crawler({
  layout,
  reducedMotion,
  seed = 1,
  params = DEFAULT_PARAMS,
  theme,
  events,
  resolveRegion,
  onDebug,
  ref,
}: CrawlerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const modelRef = useRef<CrawlerModel | null>(null)
  const layoutRef = useRef<CrawlerLayout | null>(layout)
  const measureRef = useRef<CrawlerMeasure | null>(null)
  const kickRef = useRef<() => void>(() => undefined)
  const reducedMotionRef = useRef(reducedMotion)
  const paramsRef = useRef(params)
  const resolveRef = useRef(resolveRegion)
  const debugRef = useRef(onDebug)

  useEffect(() => {
    layoutRef.current = layout
    resolveRef.current = resolveRegion
    debugRef.current = onDebug
  }, [layout, resolveRegion, onDebug])

  useEffect(() => {
    const model = createModel(seed, reducedMotionRef.current, paramsRef.current)
    const anchors = layoutRef.current?.anchors()
    if (anchors) setAnchors(model, anchors)
    modelRef.current = model
    kickRef.current()
  }, [seed])

  useEffect(() => {
    paramsRef.current = params
    const model = modelRef.current
    if (model) setParams(model, params)
    kickRef.current()
  }, [params])

  useEffect(() => {
    reducedMotionRef.current = reducedMotion
    const model = modelRef.current
    if (!model) return
    model.reducedMotion = reducedMotion
    model.nextRebuildAt = 0
    kickRef.current()
  }, [reducedMotion])

  function mutate(change: (model: CrawlerModel, now: number) => void) {
    const model = modelRef.current
    if (!model) return
    change(model, performance.now())
    kickRef.current()
  }

  const handle: CrawlerHandle = {
    start: (barCount) => mutate((model) => startRun(model, barCount)),
    setStage: (stage, progress) => mutate((model) => setStageProgress(model, stage, progress)),
    setBeam: (bar) => mutate((model) => setBeam(model, bar)),
    wrap: (input) =>
      mutate((model, now) => {
        const region = resolveRef.current ? resolveRef.current(input) : input
        let low = region.priceLow
        let high = region.priceHigh
        if (region.units === 'fraction') {
          const visible = layoutRef.current?.visiblePriceRange()
          if (!visible) return
          const span = visible.high - visible.low
          low = visible.low + span * region.priceLow
          high = visible.low + span * region.priceHigh
        }
        wrapRegion(model, { startBar: region.startBar, endBar: region.endBar, lowPrice: low, highPrice: high, label: region.label }, now)
      }),
    pulse: (nodeId, status) => mutate((model, now) => pulseNode(model, nodeId, status, now)),
    finish: () => mutate((model, now) => finishRun(model, now)),
    fail: (stage) => mutate((model, now) => failRun(model, stage, now)),
    moveSpiderTo: (point) => mutate((model) => moveSpiderTo(model, point)),
    setAggression: (level) => mutate((model) => setAggression(model, level)),
    setTempo: (tempo) => mutate((model) => setTempo(model, tempo)),
    reset: () => {
      const model = createModel(seed, reducedMotionRef.current, paramsRef.current)
      setAnchors(model, layoutRef.current?.anchors() ?? [])
      modelRef.current = model
      kickRef.current()
    },
  }

  useImperativeHandle(ref, () => handle)

  const handleRef = useRef(handle)
  useEffect(() => {
    handleRef.current = handle
  })

  useEffect(() => {
    if (!events) return
    const forward: CrawlerHandle = {
      start: (barCount) => handleRef.current.start(barCount),
      setStage: (stage, progress) => handleRef.current.setStage(stage, progress),
      setBeam: (bar) => handleRef.current.setBeam(bar),
      wrap: (region) => handleRef.current.wrap(region),
      pulse: (nodeId, status) => handleRef.current.pulse(nodeId, status),
      finish: () => handleRef.current.finish(),
      fail: (stage) => handleRef.current.fail(stage),
      reset: () => handleRef.current.reset(),
      moveSpiderTo: (point) => handleRef.current.moveSpiderTo(point),
      setAggression: (level) => handleRef.current.setAggression(level),
      setTempo: (tempo) => handleRef.current.setTempo(tempo),
    }
    const queue = new CrawlerEventQueue(forward)
    const unsubscribe = events((event) => queue.push(event))
    return () => {
      unsubscribe()
      queue.clear()
    }
  }, [events])

  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    const context = canvas?.getContext('2d')
    if (!canvas || !host || !context || !layout) return
    const renderer = new CrawlerRenderer(theme ?? readTheme())
    const initial = modelRef.current
    if (initial) setAnchors(initial, layout.anchors())

    let frame = 0
    let lastTime = performance.now()
    let pageVisible = document.visibilityState === 'visible'
    let onScreen = true
    let dpr = window.devicePixelRatio || 1

    const remeasure = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      dpr = window.devicePixelRatio || 1
      renderer.setScale(dpr)
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
      }
      measureRef.current = layout.measure()
    }

    const render = (now: number) => {
      const model = modelRef.current
      const measure = measureRef.current
      if (!model || !measure) return
      const dt = (now - lastTime) / 1000
      lastTime = now
      stepModel(model, { measure, project: layout.project, priceAt: layout.priceAt, now, dt })
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      renderer.draw(context, model, measure, now, layout.project)
      debugRef.current?.({ model, renderer, measure })
    }

    const loop = (now: number) => {
      frame = 0
      render(now)
      if (pageVisible && onScreen) frame = requestAnimationFrame(loop)
    }

    const kick = () => {
      if (frame === 0 && pageVisible && onScreen) {
        lastTime = performance.now()
        frame = requestAnimationFrame(loop)
      }
    }
    kickRef.current = kick

    const resizeObserver = new ResizeObserver(() => {
      remeasure()
      kick()
    })
    resizeObserver.observe(host)
    const intersectionObserver = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting)
      kick()
    })
    intersectionObserver.observe(canvas)
    const onVisibility = () => {
      pageVisible = document.visibilityState === 'visible'
      kick()
    }
    const onViewportChange = () => {
      remeasure()
      kick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('scroll', onViewportChange, { capture: true, passive: true })
    window.addEventListener('resize', onViewportChange)
    const unsubscribe = layout.subscribe(onViewportChange)

    remeasure()
    kick()

    return () => {
      cancelAnimationFrame(frame)
      frame = 0
      kickRef.current = () => undefined
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('scroll', onViewportChange, { capture: true })
      window.removeEventListener('resize', onViewportChange)
      unsubscribe()
    }
  }, [layout, theme])

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-20" />
}
