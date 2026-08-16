import { beforeEach, describe, expect, it } from 'vitest'
import { createReorderStore } from './reorderStore'

let store: ReturnType<typeof createReorderStore>

beforeEach(() => {
  store = createReorderStore()
})

describe('createReorderStore', () => {
  it('starts in view mode with empty arrays and no toast', () => {
    const s = store.getState()
    expect(s.mode).toBe('view')
    expect(s.originalOrder).toEqual([])
    expect(s.draftOrder).toEqual([])
    expect(s.committing).toBe(false)
    expect(s.toast).toBeNull()
  })

  it('enter snapshots the current ids into both original and draft order', () => {
    store.getState().enter([1, 2, 3])

    const s = store.getState()
    expect(s.mode).toBe('reorder')
    expect(s.originalOrder).toEqual([1, 2, 3])
    expect(s.draftOrder).toEqual([1, 2, 3])
    expect(s.toast).toBeNull()
  })

  it('enter clears any previous toast', () => {
    store.getState().setToast({ kind: 'error', message: 'old' })
    store.getState().enter([10, 20])

    expect(store.getState().toast).toBeNull()
  })

  it('enter copies the input array (mutating the source does not affect the store)', () => {
    const ids = [1, 2, 3]
    store.getState().enter(ids)
    ids.push(4)

    expect(store.getState().originalOrder).toEqual([1, 2, 3])
    expect(store.getState().draftOrder).toEqual([1, 2, 3])
  })

  it('setDraft replaces draftOrder without touching originalOrder', () => {
    store.getState().enter([1, 2, 3])
    store.getState().setDraft([3, 1, 2])

    expect(store.getState().draftOrder).toEqual([3, 1, 2])
    expect(store.getState().originalOrder).toEqual([1, 2, 3])
  })

  it('exit returns to view mode and clears all order arrays + committing flag', () => {
    store.getState().enter([1, 2, 3])
    store.getState().setCommitting(true)

    store.getState().exit()

    const s = store.getState()
    expect(s.mode).toBe('view')
    expect(s.originalOrder).toEqual([])
    expect(s.draftOrder).toEqual([])
    expect(s.committing).toBe(false)
  })

  it('setCommitting toggles the committing flag', () => {
    store.getState().setCommitting(true)
    expect(store.getState().committing).toBe(true)

    store.getState().setCommitting(false)
    expect(store.getState().committing).toBe(false)
  })

  it('setToast accepts a toast and null', () => {
    store.getState().setToast({ kind: 'success', message: 'saved' })
    expect(store.getState().toast).toEqual({ kind: 'success', message: 'saved' })

    store.getState().setToast(null)
    expect(store.getState().toast).toBeNull()
  })
})

describe('hasPending', () => {
  it('is false when draft equals original', () => {
    store.getState().enter([1, 2, 3])
    expect(store.getState().hasPending()).toBe(false)
  })

  it('is true when an item is reordered', () => {
    store.getState().enter([1, 2, 3])
    store.getState().setDraft([2, 1, 3])

    expect(store.getState().hasPending()).toBe(true)
  })

  it('is true when draft length differs (item added or removed)', () => {
    store.getState().enter([1, 2, 3])
    store.getState().setDraft([1, 2])

    expect(store.getState().hasPending()).toBe(true)
  })

  it('is false on a fresh store with both arrays empty', () => {
    expect(store.getState().hasPending()).toBe(false)
  })
})

describe('multiple stores are independent', () => {
  it('factory returns isolated state per call', () => {
    const a = createReorderStore()
    const b = createReorderStore()

    a.getState().enter([1, 2])
    expect(b.getState().mode).toBe('view')
    expect(b.getState().originalOrder).toEqual([])
  })
})
