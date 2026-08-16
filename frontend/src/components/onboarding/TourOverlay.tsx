import { useEffect, useState } from 'react'
import { useOnboardingStore } from '../../stores/onboarding'
import { TOUR_STEPS } from './tourSteps'

const PAD = 8
// 対象 DOM がまだ描画されていない場合に備えたリトライ回数・間隔。
// これを使い切っても見つからなければ、そのステップは無いものとしてスキップする
// （例: 管理者以外には「ユーザー管理」ステップが無い）。
const FIND_RETRIES = 10
const FIND_INTERVAL_MS = 100

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export default function TourOverlay() {
  const active = useOnboardingStore((s) => s.active)
  const stepIndex = useOnboardingStore((s) => s.stepIndex)
  const next = useOnboardingStore((s) => s.next)
  const prev = useOnboardingStore((s) => s.prev)
  const close = useOnboardingStore((s) => s.close)

  const [rect, setRect] = useState<Rect | null>(null)
  // 対象探索中はツールチップを出さない（見つからずスキップする一瞬のちらつき防止）
  const [resolved, setResolved] = useState(false)

  const step = active ? TOUR_STEPS[stepIndex] : undefined

  useEffect(() => {
    if (!active) return
    if (stepIndex >= TOUR_STEPS.length) {
      close()
      return
    }
  }, [active, stepIndex, close])

  // ステップが変わるたびに対象 DOM を探す。無ければリトライ→最終的にスキップ。
  useEffect(() => {
    if (!step) {
      setRect(null)
      setResolved(false)
      return
    }
    if (!step.target) {
      setRect(null)
      setResolved(true)
      return
    }

    let cancelled = false
    setResolved(false)

    function attempt(remaining: number) {
      if (cancelled) return
      const el = document.querySelector(step!.target!)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // スクロールが落ち着くのを軽く待ってから位置を確定する
        window.setTimeout(() => {
          if (cancelled) return
          setRect(rectOf(el))
          setResolved(true)
        }, 250)
        return
      }
      if (remaining <= 0) {
        // このステップの対象が無い（例: 管理者以外） → 読み飛ばす
        next()
        return
      }
      window.setTimeout(() => attempt(remaining - 1), FIND_INTERVAL_MS)
    }

    attempt(FIND_RETRIES)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, stepIndex])

  // スクロール・リサイズに追従して spotlight 位置を更新
  useEffect(() => {
    if (!active || !step?.target) return
    function update() {
      const el = document.querySelector(step!.target!)
      if (el) setRect(rectOf(el))
    }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [active, step])

  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, close])

  if (!active || !step || !resolved) return null

  const isFirst = stepIndex === 0
  const isLast = stepIndex === TOUR_STEPS.length - 1

  const tooltipStyle: React.CSSProperties = rect
    ? {
        position: 'fixed',
        top: Math.min(
          rect.top + rect.height + PAD + 8,
          window.innerHeight - 220,
        ),
        left: Math.min(Math.max(rect.left, 16), window.innerWidth - 336),
        width: 320,
      }
    : {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 360,
      }

  return (
    <div className="fixed inset-0 z-[100]" style={{ pointerEvents: 'none' }}>
      {rect && (
        <div
          className="absolute rounded-md ring-2 ring-brand-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            pointerEvents: 'none',
          }}
        />
      )}
      {!rect && <div className="absolute inset-0 bg-black/35" />}

      <div
        style={{ ...tooltipStyle, pointerEvents: 'auto' }}
        className="bg-cream-50 border border-ink/10 rounded-lg shadow-xl p-5"
        role="dialog"
        aria-label="オンボーディングツアー"
      >
        <span
          className="block text-[10px] tracking-[0.25em] uppercase text-brand-600 mb-2"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          Tour {stepIndex + 1} / {TOUR_STEPS.length}
        </span>
        <h3 className="text-base font-medium text-brand-900 mb-2">{step.title}</h3>
        <p className="text-sm text-ink-muted leading-relaxed mb-4">{step.body}</p>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={close}
            className="text-xs text-ink-muted hover:text-ink transition-colors"
          >
            {isLast ? '閉じる' : 'スキップ'}
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={prev}
                className="px-3 py-1.5 text-xs border border-ink/20 rounded-md hover:bg-ink/5 transition-colors"
              >
                戻る
              </button>
            )}
            <button
              type="button"
              onClick={isLast ? close : next}
              className="px-4 py-1.5 text-xs bg-brand-600 hover:bg-brand-700 text-white rounded-md transition-colors"
            >
              {isLast ? 'はじめる' : '次へ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
