import client from './client'
import type {
  Employee,
  EmployeeCreate,
  EmployeeImportResult,
  EmployeeUpdate,
  EmployeeUsage,
} from '../types/api'

export async function listEmployees(): Promise<Employee[]> {
  const { data } = await client.get<Employee[]>('/api/v1/employees')
  return data
}

export async function createEmployee(body: EmployeeCreate): Promise<Employee> {
  const { data } = await client.post<Employee>('/api/v1/employees', body)
  return data
}

export async function updateEmployee(
  id: number,
  body: EmployeeUpdate,
): Promise<Employee> {
  const { data } = await client.put<Employee>(`/api/v1/employees/${id}`, body)
  return data
}

export async function deleteEmployee(id: number): Promise<void> {
  await client.delete(`/api/v1/employees/${id}`)
}

export async function getEmployeeUsage(id: number): Promise<EmployeeUsage> {
  const { data } = await client.get<EmployeeUsage>(`/api/v1/employees/${id}/usage`)
  return data
}

export async function importEmployeesCsv(
  file: File,
  departmentId: number,
): Promise<EmployeeImportResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('department_id', String(departmentId))
  const { data } = await client.post<EmployeeImportResult>(
    '/api/v1/imports/employees',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data
}

export async function reorderEmployees(
  departmentId: number,
  ids: number[],
): Promise<Employee[]> {
  const { data } = await client.put<Employee[]>('/api/v1/employees/reorder', {
    department_id: departmentId,
    ids,
  })
  return data
}

export async function sortEmployeesByRole(
  departmentId: number,
): Promise<Employee[]> {
  const { data } = await client.post<Employee[]>(
    '/api/v1/employees/sort-by-role',
    { department_id: departmentId },
  )
  return data
}
