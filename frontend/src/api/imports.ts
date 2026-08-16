import client from './client'
import type { ImportResult } from '../types/api'

export async function importRoster(
  file: File,
  departmentId: number,
  year?: number,
  month?: number,
): Promise<ImportResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('department_id', String(departmentId))
  if (year !== undefined) form.append('year', String(year))
  if (month !== undefined) form.append('month', String(month))

  const res = await client.post<ImportResult>('/api/v1/imports/roster', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}
