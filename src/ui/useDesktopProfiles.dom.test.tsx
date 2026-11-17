import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useDesktopProfiles } from './useDesktopProfiles'

import type { DesktopBridge } from '../desktop'
import type { SavedProfile } from './profileModel'

afterEach(() => {
  delete window.videoskilletDesktop
})

function bridge(): DesktopBridge {
  const api: DesktopBridge = {
    listProfiles: vi.fn().mockResolvedValue([]),
    saveProfile: vi
      .fn()
      .mockResolvedValue([{ name: 'look', query: 'preset=vhs' }]),
    deleteProfile: vi.fn().mockResolvedValue([]),
  }
  window.videoskilletDesktop = api
  return api
}

describe('desktop profile library', () => {
  it('loads and saves without an account, even if the thumbnail fails', async () => {
    const api = bridge()
    const { result } = renderHook(() =>
      useDesktopProfiles(() => Promise.reject(new Error('No canvas'))),
    )
    await waitFor(() => expect(result.current.canSave).toBe(true))
    expect(result.current.user).toBeNull()
    act(() => {
      result.current.saveProfile('look', 'preset=vhs')
    })
    await waitFor(() => expect(result.current.flash?.kind).toBe('saved'))
    expect(api.saveProfile).toHaveBeenCalledWith('look', 'preset=vhs', null)
    expect(result.current.profiles[0]?.name).toBe('look')
    act(() => {
      result.current.deleteProfile('look')
    })
    await waitFor(() => expect(result.current.profiles).toEqual([]))
  })

  it('reports a failed write and keeps the committed rows', async () => {
    const api = bridge()
    const kept = [{ name: 'keep', query: 'preset=vhs' }]
    vi.mocked(api.listProfiles).mockResolvedValue(kept)
    vi.mocked(api.saveProfile).mockRejectedValue(new Error('Disk full'))
    const { result } = renderHook(() => useDesktopProfiles())
    await waitFor(() => expect(result.current.canSave).toBe(true))
    act(() => {
      result.current.saveProfile('lost', 'preset=clean')
    })
    await waitFor(() => expect(result.current.flash?.kind).toBe('failed'))
    expect(result.current.profiles).toEqual(kept)
    expect(result.current.error?.during).toBe('save')
  })

  it('preserves gesture order while earlier writes are pending', async () => {
    const api = bridge()
    let finish: (profiles: SavedProfile[]) => void = () => {}
    vi.mocked(api.saveProfile).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    const { result } = renderHook(() => useDesktopProfiles())
    await waitFor(() => expect(result.current.canSave).toBe(true))
    act(() => {
      result.current.saveProfile('first', 'preset=vhs')
      result.current.saveProfile('second', 'preset=clean')
    })
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalledTimes(1))
    act(() => {
      finish([{ name: 'first', query: 'preset=vhs' }])
    })
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.saveProfile).mock.calls.map(call => call[0])).toEqual([
      'first',
      'second',
    ])
  })

  it('allows retry after a failed load without offering sign-in', async () => {
    const api = bridge()
    vi.mocked(api.listProfiles).mockRejectedValueOnce(new Error('Cannot read'))
    const { result } = renderHook(() => useDesktopProfiles())
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.canSave).toBe(false)
    act(() => {
      result.current.signIn()
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
  })
})
