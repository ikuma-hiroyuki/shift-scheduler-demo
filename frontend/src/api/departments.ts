import api from './client'
import type { Department } from '../types/api'

export async function listDepartments(): Promise<Department[]> {
  const { data } = await api.get('/api/v1/departments')
  return data
}
