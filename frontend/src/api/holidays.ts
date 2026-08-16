import client from './client'
import type { Holiday } from '../types/api'

export async function listHolidays(year: number, month: number): Promise<Holiday[]> {
  const { data } = await client.get<Holiday[]>('/api/v1/holidays', {
    params: { year, month },
  })
  return data
}
