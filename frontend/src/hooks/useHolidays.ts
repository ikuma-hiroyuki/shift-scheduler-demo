import { useEffect, useState } from 'react'
import { listHolidays } from '../api/holidays'

export interface UseHolidaysResult {
  holidaySet: Set<number>
  holidayNameMap: Map<number, string>
  loading: boolean
}

/**
 * 指定年月の法定祝日を取得して「日 (1-31)」の Set / 名称 Map を返す。
 * year/month が null の間は空の結果を返す (loading=false)。
 */
export function useHolidays(
  year: number | null | undefined,
  month: number | null | undefined,
): UseHolidaysResult {
  const [holidaySet, setHolidaySet] = useState<Set<number>>(new Set())
  const [holidayNameMap, setHolidayNameMap] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (year == null || month == null) {
      setHolidaySet(new Set())
      setHolidayNameMap(new Map())
      return
    }

    let cancelled = false
    setLoading(true)
    listHolidays(year, month)
      .then((items) => {
        if (cancelled) return
        const set = new Set<number>()
        const map = new Map<number, string>()
        for (const h of items) {
          const day = Number(h.date.slice(8, 10))
          set.add(day)
          map.set(day, h.name)
        }
        setHolidaySet(set)
        setHolidayNameMap(map)
      })
      .catch(() => {
        if (cancelled) return
        // 祝日 API 失敗時は空扱い (UI を壊さない)
        setHolidaySet(new Set())
        setHolidayNameMap(new Map())
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [year, month])

  return { holidaySet, holidayNameMap, loading }
}
