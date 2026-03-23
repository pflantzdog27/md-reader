import { contextBridge, ipcRenderer } from 'electron'

export interface ElectronAPI {
  openFile: () => Promise<{
    success: boolean
    content?: string
    filePath?: string
    error?: string
  }>
  listVoices: () => Promise<{ name: string; locale: string }[]>
  speak: (
    text: string,
    voice: string,
    rate: number
  ) => Promise<{ success: boolean; error?: string }>
  pauseSpeech: () => Promise<void>
  resumeSpeech: () => Promise<void>
  stopSpeech: () => Promise<void>
  hasApiKey: () => Promise<boolean>
  saveApiKey: (key: string) => Promise<{ success: boolean }>
  transform: (
    markdown: string,
    prompt: string
  ) => Promise<{ success: boolean; result?: string; error?: string }>
  onTtsStateChanged: (
    callback: (data: {
      state: 'playing' | 'paused' | 'stopped' | 'finished' | 'error'
      error?: string
    }) => void
  ) => void
  onFileOpened: (
    callback: (data: {
      success: boolean
      content?: string
      filePath?: string
      error?: string
    }) => void
  ) => void
}

const api: ElectronAPI = {
  openFile: () => ipcRenderer.invoke('open-file'),
  listVoices: () => ipcRenderer.invoke('list-voices'),
  speak: (text, voice, rate) => ipcRenderer.invoke('speak', text, voice, rate),
  pauseSpeech: () => ipcRenderer.invoke('pause-speech'),
  resumeSpeech: () => ipcRenderer.invoke('resume-speech'),
  stopSpeech: () => ipcRenderer.invoke('stop-speech'),
  hasApiKey: () => ipcRenderer.invoke('has-api-key'),
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
  transform: (markdown, prompt) => ipcRenderer.invoke('transform', markdown, prompt),
  onTtsStateChanged: (callback) => {
    ipcRenderer.on('tts-state-changed', (_event, data) => callback(data))
  },
  onFileOpened: (callback) => {
    ipcRenderer.on('file-opened', (_event, data) => callback(data))
  }
}

contextBridge.exposeInMainWorld('api', api)
