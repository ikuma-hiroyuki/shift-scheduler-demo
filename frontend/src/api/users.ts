import client from './client'
import type { User, UserCreate, UserUpdate } from '../types/api'

export async function listUsers(): Promise<User[]> {
  const { data } = await client.get<User[]>('/api/v1/users')
  return data
}

export async function createUser(body: UserCreate): Promise<User> {
  const { data } = await client.post<User>('/api/v1/users', body)
  return data
}

export async function updateUser(id: number, body: UserUpdate): Promise<User> {
  const { data } = await client.put<User>(`/api/v1/users/${id}`, body)
  return data
}

export async function deleteUser(id: number): Promise<void> {
  await client.delete(`/api/v1/users/${id}`)
}
