import client from './client'
import type {
  WorkPattern,
  WorkPatternCreate,
  WorkPatternGroup,
  WorkPatternGroupCreate,
  WorkPatternGroupUpdate,
  WorkPatternUpdate,
} from '../types/api'

export async function listWorkPatterns(departmentId?: number): Promise<WorkPattern[]> {
  const params = departmentId != null ? { department_id: departmentId } : {}
  const res = await client.get<WorkPattern[]>('/api/v1/work-patterns', { params })
  return res.data
}

export async function listWorkPatternGroups(
  departmentId?: number,
): Promise<WorkPatternGroup[]> {
  const params = departmentId != null ? { department_id: departmentId } : {}
  const res = await client.get<WorkPatternGroup[]>('/api/v1/work-pattern-groups', {
    params,
  })
  return res.data
}

export async function createWorkPatternGroup(
  body: WorkPatternGroupCreate,
): Promise<WorkPatternGroup> {
  const { data } = await client.post<WorkPatternGroup>(
    '/api/v1/work-pattern-groups',
    body,
  )
  return data
}

export async function updateWorkPatternGroup(
  id: number,
  body: WorkPatternGroupUpdate,
): Promise<WorkPatternGroup> {
  const { data } = await client.put<WorkPatternGroup>(
    `/api/v1/work-pattern-groups/${id}`,
    body,
  )
  return data
}

export async function deleteWorkPatternGroup(id: number): Promise<void> {
  await client.delete(`/api/v1/work-pattern-groups/${id}`)
}

export async function createWorkPattern(
  body: WorkPatternCreate,
): Promise<WorkPattern> {
  const { data } = await client.post<WorkPattern>('/api/v1/work-patterns', body)
  return data
}

export async function updateWorkPattern(
  id: number,
  body: WorkPatternUpdate,
): Promise<WorkPattern> {
  const { data } = await client.put<WorkPattern>(
    `/api/v1/work-patterns/${id}`,
    body,
  )
  return data
}

export async function deleteWorkPattern(id: number): Promise<void> {
  await client.delete(`/api/v1/work-patterns/${id}`)
}

export async function reorderWorkPatternGroups(
  departmentId: number,
  ids: number[],
): Promise<WorkPatternGroup[]> {
  const { data } = await client.put<WorkPatternGroup[]>(
    '/api/v1/work-pattern-groups/reorder',
    { department_id: departmentId, ids },
  )
  return data
}

export async function reorderWorkPatterns(
  groupId: number,
  ids: number[],
): Promise<WorkPattern[]> {
  const { data } = await client.put<WorkPattern[]>(
    '/api/v1/work-patterns/reorder',
    { group_id: groupId, ids },
  )
  return data
}

export async function downloadWorkPatternsCsv(departmentId?: number): Promise<void> {
  const params = departmentId != null ? { department_id: departmentId } : {}
  const res = await client.get('/api/v1/work-patterns/export.csv', {
    params,
    responseType: 'blob',
  })
  const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download =
    departmentId != null ? `patterns_dept${departmentId}.csv` : 'patterns.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
