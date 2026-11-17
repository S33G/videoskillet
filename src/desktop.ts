import type { SavedProfile } from './ui/profileModel'

export interface DesktopBridge {
  listProfiles: () => Promise<SavedProfile[]>
  saveProfile: (
    name: string,
    query: string,
    thumbnail: string | null,
  ) => Promise<SavedProfile[]>
  deleteProfile: (name: string) => Promise<SavedProfile[]>
}

declare global {
  interface Window {
    videoskilletDesktop?: DesktopBridge
  }
}

export const desktopBridge = (): DesktopBridge | undefined =>
  typeof window === 'undefined' ? undefined : window.videoskilletDesktop

export const isDesktop = (): boolean => desktopBridge() !== undefined

// Shared links should open the public app on the recipient's machine.
export const shareableUrl = (url: string): string => {
  if (!isDesktop()) return url
  const parsed = new URL(url)
  return `https://videoskillet.com/app/${parsed.search}${parsed.hash}`
}
