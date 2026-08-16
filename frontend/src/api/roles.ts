import client from './client'
import type { Role, RoleCreate, RoleUpdate } from '../types/api'

export async function listRoles(): Promise<Role[]> {
  const { data } = await client.get<Role[]>('/api/v1/roles')
  return data
}

export async function createRole(body: RoleCreate): Promise<Role> {
  const { data } = await client.post<Role>('/api/v1/roles', body)
  return data
}

export async function updateRole(code: string, body: RoleUpdate): Promise<Role> {
  const { data } = await client.put<Role>(`/api/v1/roles/${code}`, body)
  return data
}

export async function deleteRole(code: string): Promise<void> {
  await client.delete(`/api/v1/roles/${code}`)
}

export async function reorderRoles(codes: string[]): Promise<Role[]> {
  const { data } = await client.put<Role[]>('/api/v1/roles/reorder', { codes })
  return data
}
