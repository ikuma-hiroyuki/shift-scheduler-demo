import client from './client'
import type {
  ChoiceGroupImportResult,
  PatternChoiceGroup,
  PatternChoiceGroupCreate,
  PatternChoiceGroupUpdate,
  PatternIncompatibility,
  PatternIncompatibilityCreate,
  PatternIncompatibilityUpdate,
} from '../types/api'

// --- PatternChoiceGroup ---

export async function listChoiceGroups(): Promise<PatternChoiceGroup[]> {
  const { data } = await client.get<PatternChoiceGroup[]>('/api/v1/choice-groups')
  return data
}

export async function createChoiceGroup(
  body: PatternChoiceGroupCreate,
): Promise<PatternChoiceGroup> {
  const { data } = await client.post<PatternChoiceGroup>(
    '/api/v1/choice-groups',
    body,
  )
  return data
}

export async function updateChoiceGroup(
  id: number,
  body: PatternChoiceGroupUpdate,
): Promise<PatternChoiceGroup> {
  const { data } = await client.put<PatternChoiceGroup>(
    `/api/v1/choice-groups/${id}`,
    body,
  )
  return data
}

export async function deleteChoiceGroup(id: number): Promise<void> {
  await client.delete(`/api/v1/choice-groups/${id}`)
}

export async function reorderChoiceGroups(
  departmentId: number,
  ids: number[],
): Promise<PatternChoiceGroup[]> {
  const { data } = await client.put<PatternChoiceGroup[]>(
    '/api/v1/choice-groups/reorder',
    { department_id: departmentId, ids },
  )
  return data
}

// --- PatternIncompatibility ---

export async function listIncompatibilities(): Promise<PatternIncompatibility[]> {
  const { data } = await client.get<PatternIncompatibility[]>(
    '/api/v1/pattern-incompatibilities',
  )
  return data
}

export async function createIncompatibility(
  body: PatternIncompatibilityCreate,
): Promise<PatternIncompatibility> {
  const { data } = await client.post<PatternIncompatibility>(
    '/api/v1/pattern-incompatibilities',
    body,
  )
  return data
}

export async function updateIncompatibility(
  id: number,
  body: PatternIncompatibilityUpdate,
): Promise<PatternIncompatibility> {
  const { data } = await client.put<PatternIncompatibility>(
    `/api/v1/pattern-incompatibilities/${id}`,
    body,
  )
  return data
}

export async function deleteIncompatibility(id: number): Promise<void> {
  await client.delete(`/api/v1/pattern-incompatibilities/${id}`)
}

export async function reorderIncompatibilities(
  departmentId: number,
  ids: number[],
): Promise<PatternIncompatibility[]> {
  const { data } = await client.put<PatternIncompatibility[]>(
    '/api/v1/pattern-incompatibilities/reorder',
    { department_id: departmentId, ids },
  )
  return data
}

// --- CSV import ---

export async function importChoiceGroupsCsv(
  file: File,
  departmentId: number,
): Promise<ChoiceGroupImportResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('department_id', String(departmentId))
  const { data } = await client.post<ChoiceGroupImportResult>(
    '/api/v1/imports/choice-groups',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data
}
