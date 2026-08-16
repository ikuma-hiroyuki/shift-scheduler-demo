import client from './client'
import type {
  AssignmentPatchRequest,
  AssignmentsResponse,
  BatchAssignmentPatchRequest,
  BatchAssignmentPatchResponse,
  CellPatchResponse,
  CompensatoryProposalsResponse,
  Schedule,
} from '../types/api'

export async function listSchedules(departmentId?: number): Promise<Schedule[]> {
  const params = departmentId != null ? { department_id: departmentId } : {}
  const res = await client.get<Schedule[]>('/api/v1/schedules', { params })
  return res.data
}

export async function generateSchedule(
  departmentId: number,
  year: number,
  month: number,
  options?: { timeLimit?: number; workers?: number },
): Promise<Schedule> {
  const body: Record<string, number> = {
    department_id: departmentId,
    year,
    month,
  }
  if (options?.timeLimit !== undefined) body.time_limit = options.timeLimit
  if (options?.workers !== undefined) body.workers = options.workers
  const res = await client.post<Schedule>('/api/v1/schedules/generate', body)
  return res.data
}

export async function getSchedule(id: number): Promise<Schedule> {
  const res = await client.get<Schedule>(`/api/v1/schedules/${id}`)
  return res.data
}

export async function cancelSchedule(id: number): Promise<Schedule> {
  const res = await client.post<Schedule>(`/api/v1/schedules/${id}/cancel`)
  return res.data
}

export async function finalizeSchedule(id: number): Promise<Schedule> {
  const res = await client.post<Schedule>(`/api/v1/schedules/${id}/finalize`)
  return res.data
}

export async function deleteSchedule(id: number): Promise<void> {
  await client.delete(`/api/v1/schedules/${id}`)
}

export async function getAssignments(id: number): Promise<AssignmentsResponse> {
  const res = await client.get<AssignmentsResponse>(`/api/v1/schedules/${id}/assignments`)
  return res.data
}

export async function exportScheduleXlsx(
  id: number,
  year: number,
  month: number,
  attempt: number,
): Promise<void> {
  const res = await client.get(`/api/v1/schedules/${id}/export`, {
    responseType: 'blob',
  })
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `shift_${year}_${String(month).padStart(2, '0')}_attempt${attempt}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

export async function patchAssignment(
  scheduleId: number,
  payload: AssignmentPatchRequest,
): Promise<CellPatchResponse> {
  const res = await client.patch<CellPatchResponse>(
    `/api/v1/schedules/${scheduleId}/assignments`,
    payload,
  )
  return res.data
}

export async function batchPatchAssignments(
  scheduleId: number,
  payload: BatchAssignmentPatchRequest,
): Promise<BatchAssignmentPatchResponse> {
  const res = await client.patch<BatchAssignmentPatchResponse>(
    `/api/v1/schedules/${scheduleId}/assignments/batch`,
    payload,
  )
  return res.data
}

export async function requestCompensatory(
  scheduleId: number,
  employeeId: number,
  targetDate: string,
): Promise<CompensatoryProposalsResponse> {
  const res = await client.post<CompensatoryProposalsResponse>(
    `/api/v1/schedules/${scheduleId}/compensatory`,
    { employee_id: employeeId, target_date: targetDate },
  )
  return res.data
}

export async function exportScheduleCsvLong(
  id: number,
  year: number,
  month: number,
  attempt: number,
): Promise<void> {
  const res = await client.get(`/api/v1/schedules/${id}/export/csv`, {
    responseType: 'blob',
  })
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `shift_${year}_${String(month).padStart(2, '0')}_attempt${attempt}_long.csv`
  a.click()
  URL.revokeObjectURL(url)
}
