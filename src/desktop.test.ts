// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'

import { isDesktop, shareableUrl } from './desktop'

afterEach(() => {
  delete window.videoskilletDesktop
})

it('keeps website links unchanged outside Electron', () => {
  expect(isDesktop()).toBe(false)
  expect(shareableUrl('https://example.com/app/#preset=vhs')).toBe(
    'https://example.com/app/#preset=vhs',
  )
})

it('copies desktop looks as public website links', () => {
  window.videoskilletDesktop = {
    listProfiles: () => Promise.resolve([]),
    saveProfile: () => Promise.resolve([]),
    deleteProfile: () => Promise.resolve([]),
  }
  expect(shareableUrl('videoskillet://app/app/#preset=vhs')).toBe(
    'https://videoskillet.com/app/#preset=vhs',
  )
})
