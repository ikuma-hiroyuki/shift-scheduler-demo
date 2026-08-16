import { useEffect, useState } from 'react'
import type { Employee, EmployeeRole } from '../../types/api'
import ModalShell from '../common/ModalShell'
import { useDirtyDiscardConfirm } from '../../hooks/useDirtyDiscardConfirm'
import { useRoleStore } from '../../stores/roles'
import { DEFAULT_ROLE_LABEL } from '../../constants/employee'

interface Props {
  mode: 'create' | 'edit'
  initial: Employee | null
  departmentId: number
  onClose: () => void
  onSubmit: (payload: {
    employee_number: number
    name: string
    role: EmployeeRole
    available_days: string
    available_shift_types: string
    consecutive_workable: boolean
  }) => Promise<void>
}
const DAYS = [
  { v: '1', label: '月' },
  { v: '2', label: '火' },
  { v: '3', label: '水' },
  { v: '4', label: '木' },
  { v: '5', label: '金' },
  { v: '6', label: '土' },
  { v: '0', label: '日' },
]
const SHIFTS = [
  { v: '1', label: '早番' },
  { v: '2', label: 'フル番' },
  { v: '3', label: '遅番' },
]

function parseCsvSet(s: string): Set<string> {
  return new Set(
    s
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  )
}

export default function EmployeeFormModal({
  mode,
  initial,
  onClose,
  onSubmit,
}: Props) {
  const storeRoles = useRoleStore((s) => s.roles)
  const ROLES =
    storeRoles.length > 0
      ? storeRoles.map((r) => ({ value: r.code, label: r.name }))
      : Object.entries(DEFAULT_ROLE_LABEL).map(([value, label]) => ({ value, label }))

  // デフォルト選択は STAFF を優先。STAFF が削除済みなら先頭の役職にフォールバック。
  const initialRole = ROLES.find((r) => r.value === 'STAFF')?.value
    ?? ROLES[0]?.value
    ?? 'STAFF'

  // useState 初期値を `initial` から同期取得し、useDirtyDiscardConfirm の baseline と一致させる。
  const [empNum, setEmpNum] = useState(() =>
    initial ? String(initial.employee_number) : '',
  )
  const [name, setName] = useState(() => initial?.name ?? '')
  const [role, setRole] = useState<EmployeeRole>(() => initial?.role ?? initialRole)
  const [days, setDays] = useState<Set<string>>(() =>
    initial
      ? parseCsvSet(initial.available_days)
      : new Set(['0', '1', '2', '3', '4', '5', '6']),
  )
  const [shifts, setShifts] = useState<Set<string>>(() =>
    initial ? parseCsvSet(initial.available_shift_types) : new Set(['1', '2', '3']),
  )
  const [workable, setWorkable] = useState(() => initial?.consecutive_workable ?? true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // initial が後から差し替わるレアケース用 (通常は親が unmount → 再 mount)。
  useEffect(() => {
    if (initial) {
      setEmpNum(String(initial.employee_number))
      setName(initial.name)
      setRole(initial.role)
      setDays(parseCsvSet(initial.available_days))
      setShifts(parseCsvSet(initial.available_shift_types))
      setWorkable(initial.consecutive_workable)
    }
  }, [initial])

  const { attemptClose, dialog: discardDialog } = useDirtyDiscardConfirm({
    // Set は JSON.stringify で `{}` にしか化けないので、安定 sort した配列に正規化する。
    values: {
      empNum,
      name,
      role,
      days: Array.from(days).sort(),
      shifts: Array.from(shifts).sort(),
      workable,
    },
    onClose,
  })

  function toggle(set: Set<string>, v: string, setter: (s: Set<string>) => void) {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    setter(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    const num = parseInt(empNum, 10)
    if (!num || num < 1) {
      setErr('社員番号を正しく入力してください')
      return
    }
    if (!name.trim()) {
      setErr('氏名を入力してください')
      return
    }
    if (days.size === 0) {
      setErr('勤務可能曜日を1つ以上選択してください')
      return
    }
    if (shifts.size === 0) {
      setErr('勤務可能番型を1つ以上選択してください')
      return
    }
    setBusy(true)
    try {
      await onSubmit({
        employee_number: num,
        name: name.trim(),
        role,
        available_days: Array.from(days).sort().join(','),
        available_shift_types: Array.from(shifts).sort().join(','),
        consecutive_workable: workable,
      })
      onClose()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setErr(typeof msg === 'string' ? msg : '保存に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={attemptClose} loading={busy}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-cream-50 border border-ink/10 rounded-sm shadow-2xl"
        style={{ animation: 'modalIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)' }}
      >
        <style>{`@keyframes modalIn { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>

        <div className="px-7 pt-6 pb-4 border-b border-ink/10 flex items-baseline justify-between">
          <h2
            className="text-2xl font-medium text-brand-900"
            style={{ fontFamily: 'var(--font-display)', fontVariationSettings: '"opsz" 96' }}
          >
            {mode === 'create' ? '従業員を追加' : '従業員を編集'}
          </h2>
          <span
            className="text-[10px] tracking-[0.3em] uppercase text-brand-600"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {mode === 'create' ? 'New' : 'Edit'}
          </span>
        </div>

        <div className="px-7 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5" style={{ fontFamily: 'var(--font-mono)' }}>
                社員番号
              </span>
              <input
                type="number"
                value={empNum}
                onChange={(e) => setEmpNum(e.target.value)}
                disabled={mode === 'edit'}
                className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base disabled:text-ink-muted"
                style={{ fontFamily: 'var(--font-mono)' }}
                required
              />
            </label>
            <label className="block">
              <span className="text-[11px] tracking-widest uppercase text-ink-muted block mb-1.5" style={{ fontFamily: 'var(--font-mono)' }}>
                氏名
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-transparent border-0 border-b border-ink/30 focus:border-brand-600 focus:outline-none px-0 py-1.5 text-base"
                required
              />
            </label>
          </div>

          <div>
            <span className="text-[11px] tracking-widest uppercase text-ink-muted block mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
              役職
            </span>
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map((r) => (
                <button
                  type="button"
                  key={r.value}
                  onClick={() => setRole(r.value)}
                  className={`px-3 py-1.5 text-xs rounded-sm border transition-all ${
                    role === r.value
                      ? 'bg-brand-900 text-cream-50 border-brand-900'
                      : 'bg-transparent text-ink border-ink/20 hover:border-ink/50'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[11px] tracking-widest uppercase text-ink-muted block mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
              勤務可能曜日
            </span>
            <div className="flex gap-1.5">
              {DAYS.map((d) => (
                <button
                  type="button"
                  key={d.v}
                  onClick={() => toggle(days, d.v, setDays)}
                  className={`w-10 h-10 text-sm rounded-sm border transition-all ${
                    days.has(d.v)
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-transparent text-ink border-ink/20 hover:border-ink/50'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[11px] tracking-widest uppercase text-ink-muted block mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
              勤務可能番型
            </span>
            <div className="flex gap-1.5">
              {SHIFTS.map((s) => (
                <button
                  type="button"
                  key={s.v}
                  onClick={() => toggle(shifts, s.v, setShifts)}
                  className={`px-4 py-1.5 text-xs rounded-sm border transition-all ${
                    shifts.has(s.v)
                      ? 'bg-brand-900 text-cream-50 border-brand-900'
                      : 'bg-transparent text-ink border-ink/20 hover:border-ink/50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={workable}
              onChange={(e) => setWorkable(e.target.checked)}
              className="w-4 h-4 accent-brand-600"
            />
            <span className="text-sm text-ink">連勤可能（上限 6 日）</span>
          </label>

          {err && (
            <p className="text-xs text-[#a83232] bg-[#a83232]/8 border-l-2 border-[#a83232] px-3 py-2">
              {err}
            </p>
          )}
        </div>

        <div className="px-7 py-4 border-t border-ink/10 flex justify-end gap-2">
          <button
            type="button"
            onClick={attemptClose}
            className="px-4 py-2 text-sm text-ink-muted hover:text-ink transition-colors"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-5 py-2 text-sm bg-brand-900 text-cream-50 hover:bg-[#1a2940] disabled:opacity-50 transition-colors rounded-sm"
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
      {discardDialog}
    </ModalShell>
  )
}
