import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_ROLE_LABEL, ROLE_LABEL, roleLabel, roleTone } from './employee'
import { useRoleStore } from '../stores/roles'

describe('DEFAULT_ROLE_LABEL map', () => {
  it.each([
    ['CHIEF', '主任'],
    ['DEPUTY', '副主任'],
    ['STAFF', '一般'],
    ['FULLPART', 'フルパート'],
    ['MORNINGPART', '早朝パート'],
  ] as const)('maps %s to %s', (key, label) => {
    expect(DEFAULT_ROLE_LABEL[key]).toBe(label)
  })

  it('ROLE_LABEL is an alias of DEFAULT_ROLE_LABEL for backward compatibility', () => {
    expect(ROLE_LABEL).toBe(DEFAULT_ROLE_LABEL)
  })
})

describe('roleLabel', () => {
  beforeEach(() => {
    useRoleStore.setState({ roles: [], loaded: false })
  })

  it('returns the JP label for known role keys (fallback)', () => {
    expect(roleLabel('CHIEF')).toBe('主任')
    expect(roleLabel('STAFF')).toBe('一般')
  })

  it('returns "" for null / undefined / empty', () => {
    expect(roleLabel(null)).toBe('')
    expect(roleLabel(undefined)).toBe('')
    expect(roleLabel('')).toBe('')
  })

  it('returns the input as-is for unknown role strings', () => {
    expect(roleLabel('UNKNOWN_ROLE')).toBe('UNKNOWN_ROLE')
  })

  it('prefers store name when role is loaded from API', () => {
    useRoleStore.getState().setRoles([
      { code: 'CHIEF', name: 'チーフ (上書き)', order_index: 0 },
      { code: 'NEWPART', name: '新人パート', order_index: 5 },
    ])
    expect(roleLabel('CHIEF')).toBe('チーフ (上書き)')
    expect(roleLabel('NEWPART')).toBe('新人パート')
  })
})

describe('roleTone', () => {
  it('returns specific color for default 5 roles', () => {
    expect(roleTone('CHIEF')).toBe('bg-brand-600 text-white')
    expect(roleTone('STAFF')).toBe('bg-ink/8 text-ink')
  })

  it('returns neutral color for unknown roles', () => {
    expect(roleTone('NEWPART')).toBe('bg-ink/8 text-ink')
    expect(roleTone(null)).toBe('bg-ink/8 text-ink')
  })
})
