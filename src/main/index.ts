import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  session,
  safeStorage
} from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'
import { execFile } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// --- Constants ---
const MAX_FILE_SIZE = 50 * 1024 // 50KB
const API_KEY_FILE = 'openai-key.enc'

// --- State ---
let mainWindow: BrowserWindow | null = null
let sayProcess: ChildProcess | null = null
let voiceAllowlist: { name: string; locale: string }[] = []

// --- Voice listing ---
function loadVoices(): Promise<{ name: string; locale: string }[]> {
  return new Promise((resolve) => {
    execFile('/usr/bin/say', ['-v', '?'], (err, stdout) => {
      if (err) {
        resolve([])
        return
      }
      const voices = stdout
        .trim()
        .split('\n')
        .map((line) => {
          const match = line.match(/^(\S+)\s+(\S+)/)
          if (!match) return null
          return { name: match[1], locale: match[2] }
        })
        .filter(Boolean) as { name: string; locale: string }[]
      resolve(voices)
    })
  })
}

// --- TTS helpers ---
function killSayProcess(): void {
  if (sayProcess) {
    try {
      sayProcess.kill('SIGTERM')
    } catch {
      // already dead
    }
    sayProcess = null
  }
}

function sendTtsState(
  state: 'playing' | 'paused' | 'stopped' | 'finished' | 'error',
  error?: string
): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tts-state-changed', { state, error })
  }
}

// --- API key helpers ---
function getApiKeyPath(): string {
  return join(app.getPath('userData'), API_KEY_FILE)
}

function saveApiKey(key: string): boolean {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: store as-is (not ideal, but functional)
    writeFileSync(getApiKeyPath(), key, 'utf-8')
    return true
  }
  const encrypted = safeStorage.encryptString(key)
  writeFileSync(getApiKeyPath(), encrypted)
  return true
}

function loadApiKey(): string | null {
  const keyPath = getApiKeyPath()
  if (!existsSync(keyPath)) return null
  try {
    const data = readFileSync(keyPath)
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(data)
    }
    return data.toString('utf-8')
  } catch {
    return null
  }
}

// --- Window creation ---
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    autoHideMenuBar: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      navigateOnDragDrop: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- App menu with Cmd+O ---
function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: async (): Promise<void> => {
            if (!mainWindow) return
            const result = await handleOpenFile()
            if (result.success) {
              mainWindow.webContents.send('file-opened', result)
            }
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// --- IPC: File operations ---
async function handleOpenFile(): Promise<{
  success: boolean
  content?: string
  filePath?: string
  error?: string
}> {
  if (!mainWindow) return { success: false, error: 'No window' }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'Cancelled' }
  }

  const filePath = result.filePaths[0]

  // Validate extension
  if (!filePath.match(/\.(md|markdown|txt)$/i)) {
    return { success: false, error: 'Invalid file type. Please select a .md file.' }
  }

  // Validate size
  try {
    const stats = statSync(filePath)
    if (stats.size > MAX_FILE_SIZE) {
      const sizeKB = Math.round(stats.size / 1024)
      return {
        success: false,
        error: `File is too large (${sizeKB}KB). Maximum size is ${MAX_FILE_SIZE / 1024}KB.`
      }
    }
  } catch {
    return { success: false, error: 'Could not read file.' }
  }

  // Read file
  try {
    const content = readFileSync(filePath, 'utf-8')
    // Kill any active TTS when loading a new file
    killSayProcess()
    sendTtsState('stopped')
    return { success: true, content, filePath }
  } catch {
    return { success: false, error: 'Could not read file.' }
  }
}

// --- Register IPC handlers ---
function registerIpcHandlers(): void {
  // File open
  ipcMain.handle('open-file', async () => {
    return handleOpenFile()
  })

  // List voices
  ipcMain.handle('list-voices', async () => {
    return voiceAllowlist
  })

  // Speak
  ipcMain.handle(
    'speak',
    async (_event, text: string, voice: string, rate: number) => {
      // Validate voice against allowlist
      const validVoice = voiceAllowlist.find((v) => v.name === voice)
      if (!validVoice) {
        return { success: false, error: 'Invalid voice selected.' }
      }

      // Validate rate as integer in range
      const rateInt = Math.round(rate)
      if (rateInt < 90 || rateInt > 350 || !Number.isFinite(rateInt)) {
        return { success: false, error: 'Invalid speech rate.' }
      }

      // Kill any existing process
      killSayProcess()

      try {
        // spawn say with voice and rate, text via stdin
        sayProcess = spawn('/usr/bin/say', ['-v', validVoice.name, '-r', String(rateInt)], {
          stdio: ['pipe', 'ignore', 'ignore']
        })

        sayProcess.stdin!.write(text)
        sayProcess.stdin!.end()

        sendTtsState('playing')

        sayProcess.on('close', (code) => {
          sayProcess = null
          if (code === 0) {
            sendTtsState('finished')
          } else {
            sendTtsState('stopped')
          }
        })

        sayProcess.on('error', (err) => {
          sayProcess = null
          sendTtsState('error', err.message)
        })

        return { success: true }
      } catch (err) {
        return { success: false, error: 'Failed to start speech.' }
      }
    }
  )

  // Pause speech
  ipcMain.handle('pause-speech', async () => {
    if (sayProcess) {
      sayProcess.kill('SIGSTOP')
      sendTtsState('paused')
    }
  })

  // Resume speech
  ipcMain.handle('resume-speech', async () => {
    if (sayProcess) {
      sayProcess.kill('SIGCONT')
      sendTtsState('playing')
    }
  })

  // Stop speech
  ipcMain.handle('stop-speech', async () => {
    killSayProcess()
    sendTtsState('stopped')
  })

  // Check API key
  ipcMain.handle('has-api-key', async () => {
    return loadApiKey() !== null
  })

  // Save API key
  ipcMain.handle('save-api-key', async (_event, key: string) => {
    try {
      saveApiKey(key)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  // Transform content via OpenAI
  ipcMain.handle(
    'transform',
    async (_event, markdown: string, prompt: string) => {
      const apiKey = loadApiKey()
      if (!apiKey) {
        return { success: false, error: 'No OpenAI API key configured.' }
      }

      try {
        // Dynamic import to avoid loading OpenAI at startup
        const { default: OpenAI } = await import('openai')
        const client = new OpenAI({ apiKey })

        const response = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are an expert content transformer. Rewrite the following markdown document according to the user's instructions. CRITICAL: Preserve ALL key information, facts, data points, and concepts from the original. The reader must be able to learn everything from the original by reading your version. Output plain text (no markdown formatting).`
            },
            {
              role: 'user',
              content: `Instructions: ${prompt}\n\nDocument:\n${markdown}`
            }
          ],
          temperature: 0.7
        })

        const result = response.choices[0]?.message?.content
        if (!result) {
          return { success: false, error: 'Empty response from OpenAI.' }
        }

        return { success: true, result }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'OpenAI request failed.'
        return { success: false, error: message }
      }
    }
  )
}

// --- App lifecycle ---
app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.mdreader.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Set Content Security Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'"
        ]
      }
    })
  })

  // Load voices at startup
  voiceAllowlist = await loadVoices()

  registerIpcHandlers()
  createMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Clean up say process on quit
app.on('before-quit', () => {
  killSayProcess()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
