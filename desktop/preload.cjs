const { contextBridge, ipcRenderer } = require('electron')

// Each operation has a fixed channel. The renderer receives no filesystem or
// general-purpose IPC access.
contextBridge.exposeInMainWorld('videoskilletDesktop', {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  /** @param {unknown} name @param {unknown} query @param {unknown} thumbnail */
  saveProfile: (name, query, thumbnail) =>
    ipcRenderer.invoke('profiles:save', { name, query, thumbnail }),
  /** @param {unknown} name */
  deleteProfile: name => ipcRenderer.invoke('profiles:delete', name),
})
