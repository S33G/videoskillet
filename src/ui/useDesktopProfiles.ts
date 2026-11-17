import { useEffect, useRef, useState } from 'react'

import { desktopBridge } from '../desktop'
import { QUERY_MAX, cleanProfileName } from './profileModel'

import type { CloudUser } from './cloud'
import type { SavedProfile } from './profileModel'
import type {
  CloudStatus,
  LibraryError,
  ProfileFlash,
  SaveOutcome,
} from './useSavedProfiles'

// A minimized window may stop producing frames. An optional preview must not
// hold the profile write open while it waits for the next canvas frame.
function captureThumbnail(grab?: (max: number) => Promise<string | null>) {
  if (grab === undefined) return Promise.resolve(null)
  return new Promise<string | null>(resolve => {
    const timeout = setTimeout(() => resolve(null), 1000)
    try {
      void grab(60_000)
        .then(resolve, () => resolve(null))
        .finally(() => clearTimeout(timeout))
    } catch {
      clearTimeout(timeout)
      resolve(null)
    }
  })
}

export function useDesktopProfiles(
  grabThumb?: (max: number) => Promise<string | null>,
) {
  const [profiles, setProfiles] = useState<SavedProfile[]>([])
  const [status, setStatus] = useState<CloudStatus>('loading')
  const [error, setError] = useState<LibraryError | null>(null)
  const [lastName, setLastName] = useState<string | null>(null)
  const [flash, setFlash] = useState<ProfileFlash | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const named = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const active = useRef(true)

  const load = () => {
    setStatus('loading')
    void desktopBridge()!
      .listProfiles()
      .then(list => {
        if (!active.current) return
        setProfiles(list)
        setStatus('ready')
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!active.current) return
        setStatus('error')
        setError({ during: 'load', cause })
      })
  }

  useEffect(() => {
    active.current = true
    load()
    return () => {
      active.current = false
      clearTimeout(timer.current)
    }
    // The bridge is fixed by the preload for the lifetime of this window.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showFlash = (next: ProfileFlash) => {
    clearTimeout(timer.current)
    setFlash(next)
    timer.current = setTimeout(
      () => setFlash(null),
      next.kind === 'saved' ? 1600 : 2600,
    )
  }

  // Serialize thumbnail capture and IPC as well as the disk writes. Two quick
  // saves retain gesture order even when the first capture finishes last.
  const commit = (
    action: () => Promise<SavedProfile[]>,
    savedName?: string,
  ) => {
    const mine = ++named.current
    queue.current = queue.current
      .then(action)
      .then(list => {
        if (!active.current) return
        setProfiles(list)
        setError(null)
        if (savedName !== undefined) {
          if (named.current === mine) setLastName(savedName)
          showFlash({ kind: 'saved', name: savedName })
        }
      })
      .catch((cause: unknown) => {
        if (!active.current) return
        setError({ during: 'save', cause })
        showFlash({ kind: 'failed' })
      })
  }

  return {
    profiles,
    user: null as CloudUser | null,
    status,
    error,
    lastName,
    flash,
    canSave: status === 'ready',
    saveProfile: (name: string, query: string): SaveOutcome => {
      if (query.length > QUERY_MAX) {
        setError({ during: 'too-long', length: query.length })
        showFlash({ kind: 'failed' })
        return 'too-long'
      }
      if (status !== 'ready') {
        showFlash({ kind: 'failed' })
        return 'failed'
      }
      // Capture the current board now; prevent an optional thumbnail rejection
      // from losing the profile or producing an unhandled rejection.
      const still = captureThumbnail(grabThumb)
      const cleanName = cleanProfileName(name)
      commit(
        async () => desktopBridge()!.saveProfile(cleanName, query, await still),
        cleanName,
      )
      return 'saving'
    },
    deleteProfile: (name: string) => {
      commit(() => desktopBridge()!.deleteProfile(name))
      setLastName(current => (current === name ? null : current))
    },
    markRecalled: (name: string) => {
      named.current++
      setLastName(name)
    },
    dropPending: () => {},
    // The shared menu uses this action to retry a failed library load.
    signIn: load,
    signOut: () => {},
  }
}
