import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from './auth'
import * as authApi from '../api/auth'
import type { User } from '../types/api'

function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (s: string) =>
    btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  return `${header}.${body}.signature`
}

afterEach(() => {
  useAuthStore.setState({ token: null, currentUser: null })
  localStorage.removeItem('access_token')
  localStorage.removeItem('current_user_id')
  vi.restoreAllMocks()
})

describe('useAuthStore', () => {
  it('setToken stores token in state and localStorage', () => {
    useAuthStore.getState().setToken('abc.def.ghi')

    expect(useAuthStore.getState().token).toBe('abc.def.ghi')
    expect(localStorage.getItem('access_token')).toBe('abc.def.ghi')
  })

  it('logout clears token from state and localStorage', () => {
    useAuthStore.getState().setToken('xyz')
    useAuthStore.getState().logout()

    expect(useAuthStore.getState().token).toBeNull()
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('setToken overwrites a previous token', () => {
    useAuthStore.getState().setToken('first')
    useAuthStore.getState().setToken('second')

    expect(useAuthStore.getState().token).toBe('second')
    expect(localStorage.getItem('access_token')).toBe('second')
  })

  it('logout is idempotent when no token is set', () => {
    useAuthStore.getState().logout()

    expect(useAuthStore.getState().token).toBeNull()
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('setToken with a valid JWT writes sub claim into current_user_id', () => {
    const jwt = makeJwt({ sub: 'alice@example.com' })

    useAuthStore.getState().setToken(jwt)

    expect(localStorage.getItem('current_user_id')).toBe('alice@example.com')
  })

  it('setToken with an undecodable token leaves current_user_id untouched', () => {
    localStorage.setItem('current_user_id', 'previous-user')

    useAuthStore.getState().setToken('not.a.real.jwt.value')

    expect(localStorage.getItem('current_user_id')).toBe('previous-user')
  })

  it('setToken with a JWT lacking sub leaves current_user_id untouched', () => {
    localStorage.setItem('current_user_id', 'previous-user')
    const jwt = makeJwt({ name: 'no-sub' })

    useAuthStore.getState().setToken(jwt)

    expect(localStorage.getItem('current_user_id')).toBe('previous-user')
  })

  it('logout does not remove current_user_id', () => {
    const jwt = makeJwt({ sub: 'bob@example.com' })
    useAuthStore.getState().setToken(jwt)
    useAuthStore.getState().logout()

    expect(localStorage.getItem('current_user_id')).toBe('bob@example.com')
  })

  // ----- issue #141: currentUser -----

  it('setCurrentUser stores user in state', () => {
    const u: User = { id: 1, email: 'admin@x.com', is_active: true, is_admin: true }
    useAuthStore.getState().setCurrentUser(u)

    expect(useAuthStore.getState().currentUser).toEqual(u)
  })

  it('logout clears currentUser', () => {
    const u: User = { id: 1, email: 'admin@x.com', is_active: true, is_admin: true }
    useAuthStore.getState().setToken('abc')
    useAuthStore.getState().setCurrentUser(u)

    useAuthStore.getState().logout()

    expect(useAuthStore.getState().currentUser).toBeNull()
  })

  it('fetchCurrentUser calls api and sets state when token exists', async () => {
    const u: User = { id: 2, email: 'user@x.com', is_active: true, is_admin: false }
    const spy = vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(u)
    useAuthStore.getState().setToken('any')

    await useAuthStore.getState().fetchCurrentUser()

    expect(spy).toHaveBeenCalledOnce()
    expect(useAuthStore.getState().currentUser).toEqual(u)
  })

  it('fetchCurrentUser is no-op when no token is set', async () => {
    const spy = vi.spyOn(authApi, 'getCurrentUser')

    await useAuthStore.getState().fetchCurrentUser()

    expect(spy).not.toHaveBeenCalled()
    expect(useAuthStore.getState().currentUser).toBeNull()
  })
})
