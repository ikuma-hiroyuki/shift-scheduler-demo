import client from './client'
import type {
  EmployeePatternPriority,
  EmployeePatternPriorityCreate,
  EmployeePatternPriorityUpdate,
  EmployeePriorityImportResult,
} from '../types/api'

export async function listEmployeePriorities(
  departmentId: number,
): Promise<EmployeePatternPriority[]> {
  const { data } = await client.get<EmployeePatternPriority[]>(
    '/api/v1/employee-priorities',
    { params: { department_id: departmentId } },
  )
  return data
}

export async function createEmployeePriority(
  body: EmployeePatternPriorityCreate,
): Promise<EmployeePatternPriority> {
  const { data } = await client.post<EmployeePatternPriority>(
    '/api/v1/employee-priorities',
    body,
  )
  return data
}

/**
 * priority=0 はサーバ側で DELETE に変換され 204 を返す。
 * その場合戻り値は null。1 以上で更新成功時は更新後レコード。
 */
export async function updateEmployeePriority(
  id: number,
  body: EmployeePatternPriorityUpdate,
): Promise<EmployeePatternPriority | null> {
  const res = await client.put<EmployeePatternPriority | ''>(
    `/api/v1/employee-priorities/${id}`,
    body,
  )
  if (res.status === 204) return null
  return res.data as EmployeePatternPriority
}

export async function deleteEmployeePriority(id: number): Promise<void> {
  await client.delete(`/api/v1/employee-priorities/${id}`)
}

export async function importEmployeePrioritiesCsv(
  file: File,
  departmentId: number,
): Promise<EmployeePriorityImportResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('department_id', String(departmentId))
  const { data } = await client.post<EmployeePriorityImportResult>(
    '/api/v1/imports/employee-priorities',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data
}
