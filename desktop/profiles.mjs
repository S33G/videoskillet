import {
  QUERY_MAX,
  cleanItemName,
  readItems,
  removeItem,
  upsertItem,
} from 'skillet-shared/saved-list'

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const THUMBNAIL_MAX = 60_000

function profileName(raw) {
  if (typeof raw !== 'string' || raw.length > 1000)
    throw new Error('Invalid profile name')
  const name = cleanItemName(raw)
  if (name === '') throw new Error('A profile needs a name')
  return name
}

// Reads and edits share a queue. Every edit starts with the latest committed
// file, including edits arriving from another trusted application window.
export function createProfileStore(file) {
  let queue = Promise.resolve()
  const serial = action => {
    const result = queue.then(action)
    queue = result.catch(() => {})
    return result
  }
  const read = async () => {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT')
        return { version: 1, profiles: [], thumbnails: {} }
      throw error
    }
    const raw = JSON.parse(text)
    // Preserve an unreadable or newer file for recovery instead of replacing
    // it with an empty library on the next save.
    if (raw?.version !== 1 || !Array.isArray(raw.profiles))
      throw new Error('Unsupported profile library format')
    const profiles = readItems(raw.profiles)
    const thumbnails = {}
    for (const profile of profiles) {
      const thumb = raw.thumbnails?.[profile.id]
      if (validThumbnail(thumb)) thumbnails[profile.id] = thumb
    }
    return { version: 1, profiles, thumbnails }
  }
  const edit = action =>
    serial(async () => {
      const data = await read()
      action(data)
      const ids = new Set(data.profiles.map(profile => profile.id))
      data.thumbnails = Object.fromEntries(
        Object.entries(data.thumbnails).filter(([id]) => ids.has(id)),
      )
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.tmp`
      try {
        await writeFile(temporary, `${JSON.stringify(data)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
          flush: true,
        })
        await rename(temporary, file)
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
      return data.profiles
    })

  return {
    list: () => serial(async () => (await read()).profiles),
    save: payload => {
      const name = profileName(payload?.name)
      if (typeof payload.query !== 'string' || payload.query.length > QUERY_MAX)
        throw new Error('Invalid profile query')
      if (payload.thumbnail != null && !validThumbnail(payload.thumbnail))
        throw new Error('Invalid profile thumbnail')
      return edit(data => {
        data.profiles = upsertItem(
          data.profiles,
          name,
          payload.query,
          Date.now(),
        )
        const profile = data.profiles.find(item => item.name === name)
        if (payload.thumbnail != null)
          data.thumbnails[profile.id] = payload.thumbnail
        else delete data.thumbnails[profile.id]
      })
    },
    delete: raw => {
      const name = profileName(raw)
      return edit(data => {
        data.profiles = removeItem(data.profiles, name)
      })
    },
  }
}

function validThumbnail(raw) {
  return (
    typeof raw === 'string' &&
    raw.length <= THUMBNAIL_MAX &&
    /^[A-Za-z0-9+/=]+$/.test(raw)
  )
}
