import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  protocol,
  session,
  shell,
} from 'electron'

import { APP_URL, isAppUrl, serveAsset, windowAction } from './assets.mjs'
import { createProfileStore } from './profiles.mjs'

import {
  appendFileSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep this name stable across versions and portable executable locations.
app.setName('videoskillet')
app.setPath(
  'userData',
  app.commandLine.getSwitchValue('user-data-dir') ||
    join(app.getPath('appData'), 'videoskillet-desktop'),
)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'videoskillet',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

const preload = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const webPreferences = {
  preload,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  // The controls window portals into the opener's React tree.
  // Keeping both windows active matters during a live performance.
  backgroundThrottling: false,
}
let mainWindow

function trustedFrame(frame) {
  return frame !== null && isAppUrl(frame.url)
}

function configureWindow(window) {
  window.setMenuBarVisibility(false)
  const contents = window.webContents
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  contents.setWindowOpenHandler(({ url, frameName }) => {
    const action = windowAction(url, frameName)
    if (action === 'controls')
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { webPreferences },
      }
    if (action === 'external') void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('did-create-window', child => configureWindow(child))
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    title: 'videoskillet',
    backgroundColor: '#000000',
    webPreferences,
  })
  configureWindow(mainWindow)
  mainWindow.on('closed', () => {
    mainWindow = undefined
    for (const window of BrowserWindow.getAllWindows()) window.close()
  })
  const draft = join(app.getPath('userData'), 'last-patch.txt')
  let hash = ''
  try {
    const previous = readFileSync(draft, 'utf8')
    if (
      previous.startsWith('#') &&
      dialog.showMessageBoxSync(mainWindow, {
        message: 'Reopen your last patch?',
        buttons: ['Reopen patch', 'Start fresh'],
        defaultId: 0,
        cancelId: 1,
      }) === 0
    )
      hash = previous
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Reading last patch', error)
  }
  mainWindow.webContents.on('did-navigate-in-page', (_event, address, top) => {
    if (!top || !isAppUrl(address)) return
    const url = new URL(address)
    if (url.pathname !== '/app/' || !url.hash || url.hash === hash) return
    try {
      writeFileSync(draft + '.tmp', url.hash)
      renameSync(draft + '.tmp', draft)
      hash = url.hash
    } catch (error) {
      console.error('Saving last patch', error)
    }
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    try {
      appendFileSync(
        join(app.getPath('userData'), 'desktop-crashes.log'),
        JSON.stringify({ at: new Date().toISOString(), ...details }) + '\n',
      )
    } catch (error) {
      console.error(error)
    }
    if (
      dialog.showMessageBoxSync(mainWindow, {
        message: 'The video window stopped. Reopen the last patch?',
        buttons: ['Reopen', 'Close'],
        cancelId: 1,
      }) === 0
    )
      void mainWindow.loadURL(APP_URL + hash)
    else mainWindow.close()
  })
  void mainWindow.loadURL(APP_URL + hash)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
  })
  app
    .whenReady()
    .then(() => {
      const root = app.isPackaged
        ? join(process.resourcesPath, 'web')
        : fileURLToPath(new URL('../../dist/', import.meta.url))
      protocol.handle('videoskillet', request => serveAsset(request, root))
      const store = createProfileStore(
        join(app.getPath('userData'), 'profiles.json'),
      )
      for (const [channel, action] of [
        ['profiles:list', () => store.list()],
        ['profiles:save', payload => store.save(payload)],
        ['profiles:delete', name => store.delete(name)],
      ])
        ipcMain.handle(channel, (event, payload) => {
          if (!trustedFrame(event.senderFrame))
            throw new Error('Untrusted window')
          return action(payload)
        })

      const ses = session.defaultSession
      const permissions = new Set([
        'media',
        'display-capture',
        'fileSystem',
        'midi',
        'midiSysex',
        'clipboard-sanitized-write',
        'fullscreen',
        'pointerLock',
      ])
      const prompted = new Set(['media', 'midi', 'midiSysex', 'fileSystem'])
      const granted = new Set()
      const permissionKey = (permission, details) =>
        permission === 'fileSystem'
          ? `${permission}:${details.fileAccessType}:${details.filePath}`
          : permission
      ses.setPermissionCheckHandler((contents, permission, origin, details) => {
        if (!contents || !isAppUrl(origin) || !permissions.has(permission))
          return false
        return (
          !prompted.has(permission) ||
          granted.has(permissionKey(permission, details))
        )
      })
      ses.setPermissionRequestHandler(
        async (contents, permission, callback, details) => {
          if (
            !isAppUrl(details.requestingUrl ?? contents.getURL()) ||
            !permissions.has(permission)
          ) {
            callback(false)
            return
          }
          if (
            permission === 'fileSystem' &&
            details.fileAccessType !== 'readable'
          ) {
            callback(false)
            return
          }
          if (prompted.has(permission)) {
            const key = permissionKey(permission, details)
            if (granted.has(key)) {
              callback(true)
              return
            }
            const owner = BrowserWindow.fromWebContents(contents)
            let response = 1
            try {
              const answer = await dialog.showMessageBox(owner, {
                type: 'question',
                buttons: ['Allow', 'Cancel'],
                defaultId: 1,
                cancelId: 1,
                message:
                  permission === 'media'
                    ? `Allow access to ${details.mediaTypes?.join(' and ') || 'camera and microphone'}?`
                    : permission === 'fileSystem'
                      ? `Allow reading ${details.filePath}?`
                      : 'Allow access to MIDI devices?',
              })
              response = answer.response
            } catch {
              callback(false)
              return
            }
            if (response === 0) granted.add(key)
            callback(response === 0)
          } else callback(true)
        },
      )
      ses.setDisplayMediaRequestHandler(async (request, callback) => {
        if (!trustedFrame(request.frame)) {
          callback({})
          return
        }
        try {
          const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
          })
          const { response } = await dialog.showMessageBox({
            type: 'question',
            message: 'Choose a screen or window to capture',
            buttons: ['Cancel', ...sources.map(source => source.name)],
            defaultId: 0,
            cancelId: 0,
          })
          const source = sources[response - 1]
          callback(source ? { video: source } : {})
        } catch {
          callback({})
        }
      })
      ses.on('will-download', (_event, item, contents) => {
        if (!isAppUrl(contents.getURL())) {
          item.cancel()
          return
        }
        item.setSaveDialogOptions({ defaultPath: item.getFilename() })
      })
      createWindow()
    })
    .catch(error => {
      dialog.showErrorBox('videoskillet could not start', String(error))
      app.quit()
    })
  app.on('window-all-closed', () => app.quit())
}
