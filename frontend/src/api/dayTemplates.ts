import client from './client'
import type {
  DayOverride,
  DayOverrideCreate,
  DayOverrideUpdate,
  DayTemplate,
  DayTemplateCreate,
  DayTemplateImportResult,
  DayTemplateUpdate,
} from '../types/api'

// --- DayTemplate ---

export async function listDayTemplates(): Promise<DayTemplate[]> {
  const { data } = await client.get<DayTemplate[]>('/api/v1/day-templates')
  return data
}

export async function createDayTemplate(
  body: DayTemplateCreate,
): Promise<DayTemplate> {
  const { data } = await client.post<DayTemplate>('/api/v1/day-templates', body)
  return data
}

export async function updateDayTemplate(
  id: number,
  body: DayTemplateUpdate,
): Promise<DayTemplate> {
  const { data } = await client.put<DayTemplate>(
    `/api/v1/day-templates/${id}`,
    body,
  )
  return data
}

export async function deleteDayTemplate(id: number): Promise<void> {
  await client.delete(`/api/v1/day-templates/${id}`)
}

export async function reorderDayTemplates(
  departmentId: number,
  ids: number[],
): Promise<DayTemplate[]> {
  const { data } = await client.put<DayTemplate[]>(
    '/api/v1/day-templates/reorder',
    { department_id: departmentId, ids },
  )
  return data
}

// --- DayOverride ---

export async function listDayOverrides(): Promise<DayOverride[]> {
  const { data } = await client.get<DayOverride[]>('/api/v1/day-overrides')
  return data
}

export async function createDayOverride(
  body: DayOverrideCreate,
): Promise<DayOverride> {
  const { data } = await client.post<DayOverride>('/api/v1/day-overrides', body)
  return data
}

export async function updateDayOverride(
  id: number,
  body: DayOverrideUpdate,
): Promise<DayOverride> {
  const { data } = await client.put<DayOverride>(
    `/api/v1/day-overrides/${id}`,
    body,
  )
  return data
}

export async function deleteDayOverride(id: number): Promise<void> {
  await client.delete(`/api/v1/day-overrides/${id}`)
}

export async function reorderDayOverrides(
  departmentId: number,
  ids: number[],
): Promise<DayOverride[]> {
  const { data } = await client.put<DayOverride[]>(
    '/api/v1/day-overrides/reorder',
    { department_id: departmentId, ids },
  )
  return data
}

// --- CSV import ---

export async function importDayTemplatesCsv(
  file: File,
  departmentId: number,
): Promise<DayTemplateImportResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('department_id', String(departmentId))
  const { data } = await client.post<DayTemplateImportResult>(
    '/api/v1/imports/day-templates',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data
}
