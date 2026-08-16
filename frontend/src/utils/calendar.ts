/**
 * 0=日, 1=月, ..., 6=土 を返す (JavaScript の Date.getDay と同じ規約)。
 */
export function getDayOfWeek(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay()
}

export function isSunday(year: number, month: number, day: number): boolean {
  return getDayOfWeek(year, month, day) === 0
}

export function isSaturday(year: number, month: number, day: number): boolean {
  return getDayOfWeek(year, month, day) === 6
}

/**
 * 日曜または法定祝日なら true。祝日は呼出側で取得した日 (1-31) の Set を渡す。
 */
export function isSundayOrHoliday(
  year: number,
  month: number,
  day: number,
  holidaySet: Set<number>,
): boolean {
  return isSunday(year, month, day) || holidaySet.has(day)
}
