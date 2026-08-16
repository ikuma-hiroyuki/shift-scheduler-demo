import client from './client'
import type {
  LeaveRequest,
  LeaveRequestCreate,
  LeaveRequestUpdate,
} from '../types/api'

export async function listLeaveRequests(params: {
  department_id: number
  year: number
  month: number
}): Promise<LeaveRequest[]> {
  const res = await client.get<LeaveRequest[]>('/api/v1/leave-requests', { params })
  return res.data
}

export async function createLeaveRequest(
  body: LeaveRequestCreate,
): Promise<LeaveRequest> {
  const res = await client.post<LeaveRequest>('/api/v1/leave-requests', body)
  return res.data
}

export async function updateLeaveRequest(
  id: number,
  body: LeaveRequestUpdate,
): Promise<LeaveRequest> {
  const res = await client.put<LeaveRequest>(`/api/v1/leave-requests/${id}`, body)
  return res.data
}

export async function deleteLeaveRequest(id: number): Promise<void> {
  await client.delete(`/api/v1/leave-requests/${id}`)
}
