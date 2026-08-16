import client from './client'
import type {
  PatternTrigger,
  PatternTriggerCreate,
  PatternTriggerImportResult,
  PatternTriggerUpdate,
} from '../types/api'

export async function listPatternTriggers(): Promise<PatternTrigger[]> {
  const { data } = await client.get<PatternTrigger[]>('/api/v1/pattern-triggers')
  return data
}

export async function createPatternTrigger(
  body: PatternTriggerCreate,
): Promise<PatternTrigger> {
  const { data } = await client.post<PatternTrigger>(
    '/api/v1/pattern-triggers',
    body,
  )
  return data
}

export async function updatePatternTrigger(
  id: number,
  body: PatternTriggerUpdate,
): Promise<PatternTrigger> {
  const { data } = await client.put<PatternTrigger>(
    `/api/v1/pattern-triggers/${id}`,
    body,
  )
  return data
}

export async function deletePatternTrigger(id: number): Promise<void> {
  await client.delete(`/api/v1/pattern-triggers/${id}`)
}

export async function reorderPatternTriggers(
  departmentId: number,
  ids: number[],
): Promise<PatternTrigger[]> {
  const { data } = await client.put<PatternTrigger[]>(
    '/api/v1/pattern-triggers/reorder',
    { department_id: departmentId, ids },
  )
  return data
}

export async function importPatternTriggersCsv(
  file: File,
  departmentId: number,
): Promise<PatternTriggerImportResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('department_id', String(departmentId))
  const { data } = await client.post<PatternTriggerImportResult>(
    '/api/v1/imports/pattern-triggers',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data
}
