---
title: "feat: MD Reader Desktop App"
type: feat
date: 2026-03-22
status: reviewed
---

# feat: MD Reader Desktop App

## Overview

Build a macOS desktop app (Electron + React) that loads markdown files and reads them aloud via system TTS. Users can adjust playback speed (0.5x-2x), choose from macOS system voices, and optionally transform content through OpenAI before reading (e.g., "explain like a 6th grader", "turn into a fairytale").

## Proposed Solution

A single-window Electron app with:
1. File picker (button only, no drag-and-drop for v1) -> markdown preview panel
2. Playback controls (play/pause/stop, speed, voice) in one component
3. Optional AI transformation with preset and custom prompts
4. File size limit (~50KB) to control costs

## Technical Approach

### Architecture

```
┌──────────────────────────────────────────────────┐
│              Electron Main Process                │
│  ┌──────────────────────────────────────────────┐│
│  │ src/main/index.ts                            ││
│  │  - BrowserWindow + CSP                       ││
│  │  - IPC: open-file, speak, pause, resume,     ││
│  │         stop, list-voices, transform          ││
│  │  - say child process management              ││
│  │  - OpenAI API calls                          ││
│  │  - Process cleanup on quit                   ││
│  └──────────────────────────────────────────────┘│
├──────────────────────────────────────────────────┤
│  src/preload/index.ts (contextBridge)            │
│  - Typed API: openFile, speak, pause, resume,    │
│    stop, listVoices, transform, onTtsStateChange │
├──────────────────────────────────────────────────┤
│              Renderer (React + useState)          │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐ │
│  │ App.tsx  │  │ Markdown │  │ Transform      │ │
│  │ (state)  │  │ Preview  │  │ Panel          │ │
│  ├──────────┤  ├──────────┤  ├────────────────┤ │
│  │ Playback Controls (play/pause/stop/speed/   │ │
│  │           voice all in one component)        │ │
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

### Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Framework | electron-vite (react-ts template) | Best DX, fast HMR, convention-based structure |
| UI | React + TypeScript | Mature, fast to build |
| State | useState in App.tsx | App is small enough; no state library needed |
| Styling | Plain CSS (one file) | Single-window app with ~5 components doesn't need Tailwind |
| Markdown render | react-markdown (NO rehype-raw) | Standard for rendering MD in React; raw HTML disabled for security |
| Markdown -> text | strip-markdown only | Simple stripping is sufficient; custom remark plugins are premature |
| TTS | macOS `say` via spawn (NO shell:true) | Pause via SIGSTOP/SIGCONT, speed via -r flag |
| AI | OpenAI Node.js SDK (non-streaming) | Simple await call; 50KB docs return in 3-8s, spinner is fine |
| API key storage | Electron safeStorage API | OS-level encryption via macOS Keychain |
| Packaging | electron-builder | Mature macOS DMG support |

### Simplifications from Review

Removed from original plan based on simplicity review:
- **Zustand** -> useState (shallow component tree, no prop drilling issue)
- **3 separate stores** -> state lifted to App.tsx
- **5 IPC handler files + 2 service files** -> all IPC in src/main/index.ts
- **Streaming OpenAI** -> simple await (50KB files return fast enough)
- **js-tiktoken** -> 50KB file limit makes token counting unnecessary
- **Drag-and-drop** -> file dialog button only for v1
- **Custom remark TTS plugin** -> strip-markdown alone
- **Separate SpeedSlider, VoiceSelector** -> merged into PlaybackControls
- **Separate PresetButtons** -> merged into TransformPanel
- **SettingsPanel component** -> simple dialog on first use
- **Window state persistence** -> hardcoded reasonable size
- **Tailwind + PostCSS** -> plain CSS file

### Security Design (from Security Review)

**BrowserWindow config:**
```ts
webPreferences: {
  preload: join(__dirname, '../preload/index.ts'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  navigateOnDragDrop: false  // prevent file:// navigation
}
```

**Content Security Policy (set via session headers in main process):**
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; font-src 'self';
object-src 'none'; base-uri 'self'
```
Note: connect-src is 'self' only because OpenAI calls go through main process IPC, not renderer.

**`say` command injection prevention:**
- spawn() NEVER uses { shell: true }
- Voice name validated against allowlist from `say -v ?` output
- Rate validated as integer 90-350 in main process before passing to args
- Text ONLY sent via stdin, never as command-line argument

**File path validation (main process):**
- Validate .md extension
- Resolve to absolute path with path.resolve()
- Check file size < 50KB
- Use dialog.showOpenDialog (OS-controlled, inherently safe)

**API key storage:**
- Use Electron safeStorage.encryptString() / decryptString()
- Key stored encrypted in app data directory
- Never passed to renderer process
- Never logged or included in error messages
- Scrubbed from env before spawning say child processes

### IPC Contract

```typescript
// Renderer -> Main (invoke/handle)
'open-file': () => { success: boolean; content?: string; filePath?: string; error?: string }
'list-voices': () => { name: string; locale: string }[]
'speak': (text: string, voice: string, rate: number) => { success: boolean; error?: string }
'pause-speech': () => void
'resume-speech': () => void
'stop-speech': () => void
'transform': (markdown: string, prompt: string) => { success: boolean; result?: string; error?: string }
'save-api-key': (key: string) => { success: boolean }
'has-api-key': () => boolean

// Main -> Renderer (webContents.send, exposed via preload callback)
'tts-state-changed': { state: 'playing' | 'paused' | 'stopped' | 'finished' | 'error'; error?: string }
```

### TTS Strategy

Use `child_process.spawn('/usr/bin/say', [...])` in the main process:
- **Play**: spawn say with voice (-v) and rate (-r) flags, pipe text via stdin
- **Pause**: send SIGSTOP to the child process
- **Resume**: send SIGCONT to the child process
- **Stop**: send SIGTERM and kill process
- **Finished**: listen for process 'close' event, send 'tts-state-changed' to renderer
- **Error**: listen for process 'error' event, send error state to renderer
- **Speed**: map 0.5x=90, 1x=175, 1.5x=260, 2x=350 WPM. Changes take effect on next playback.
- **Voice list**: run `say -v ?` at app startup, parse and cache as allowlist
- **App quit cleanup**: kill any active say process on app.on('before-quit')

### OpenAI Transformation

- Non-streaming chat.completions.create() call (simple await)
- System prompt: "Rewrite the following markdown document. Preserve ALL key information, facts, and structure. [user's transformation instruction]"
- Preset prompts: "6th grader", "fairytale", "executive summary", "podcast script"
- Custom prompt: free-text input
- Model: gpt-4o-mini
- Cache transformed result for session (clear on new file load)
- Error states: API unreachable, invalid key, rate limited -> clear error messages

## Minimal File Structure

```
src/
  main/
    index.ts              # Window + ALL IPC handlers + say/OpenAI logic
  preload/
    index.ts              # contextBridge typed API
  renderer/
    index.html
    src/
      main.tsx
      App.tsx              # All state lives here
      App.css              # All styles
      components/
        MarkdownPreview.tsx
        PlaybackControls.tsx  # play/pause/stop + speed + voice in one
        TransformPanel.tsx    # presets + custom prompt + loading + result
      types/
        electron.d.ts
```

10 source files total.

## Implementation Phases

### Phase 1: Scaffold & Core Shell

**Tasks:**
- [x] Scaffold with `npm create @quick-start/electron@latest -- --template react-ts`
- [x] Configure BrowserWindow with security settings (contextIsolation, sandbox, navigateOnDragDrop:false)
- [x] Configure Content Security Policy via session.defaultSession.webRequest.onHeadersReceived
- [x] Set up preload/index.ts with typed contextBridge API (all channels from IPC contract)
- [x] Create App.tsx shell with header and main content area
- [x] Add App.css with basic layout styles
- [x] Add electron.d.ts type declarations for window.electronAPI
- [x] Verify dev server and hot reload work

### Phase 2: File Loading & Markdown Preview

**Tasks:**
- [x] IPC handler in main/index.ts: dialog.showOpenDialog filtered to .md, validate path and size (50KB), read file
- [x] App.tsx state: filePath, rawContent, transformedContent, error
- [x] "Open File" button in App.tsx that calls window.electronAPI.openFile()
- [x] MarkdownPreview component using react-markdown (NO rehype-raw plugin)
- [x] File size error display when limit exceeded
- [x] Cmd+O menu shortcut for opening files (via Electron Menu)

### Phase 3: TTS Playback

**Tasks:**
- [x] TTS logic in main/index.ts: spawn /usr/bin/say, manage child process (play/pause/resume/stop)
- [x] Voice listing: parse `say -v ?` at startup, cache as allowlist
- [x] Input validation: voice must match allowlist, rate must be integer 90-350
- [x] Text sent only via stdin, never as CLI arg
- [x] Process lifecycle events: 'close' -> send tts-state-changed:finished, 'error' -> send error
- [x] Kill say process on app.on('before-quit') and on new file load while playing
- [x] strip-markdown in renderer to convert markdown to plain text for TTS
- [x] PlaybackControls component: play/pause toggle, stop button, speed slider (0.5x-2x), voice dropdown
- [x] App.tsx state: ttsState (stopped/playing/paused), selectedVoice, speed

### Phase 4: AI Transformation

**Tasks:**
- [x] API key management: safeStorage.encryptString/decryptString, stored in app.getPath('userData')
- [x] On first launch or if no key: prompt dialog asking for OpenAI API key
- [x] IPC handler: 'has-api-key' and 'save-api-key' channels
- [x] OpenAI call in main/index.ts: non-streaming chat.completions.create with gpt-4o-mini
- [x] Preset prompts: "Explain like a 6th grader", "Fairytale version", "Executive summary", "Podcast script"
- [x] TransformPanel component: preset buttons + custom prompt input + loading spinner + result display
- [x] Cache transformed content in App.tsx state (cleared on new file load)
- [x] "Read Original" / "Read Transformed" toggle for what TTS reads
- [x] Error handling: network failure, invalid key, rate limit -> clear user-facing messages

### Phase 5: Polish & Packaging

**Tasks:**
- [x] Error boundaries: wrap App in React error boundary, handle IPC errors consistently
- [x] electron-builder.yml config for macOS DMG
- [x] Hardcode reasonable window size (900x700)
- [x] Final CSS polish pass
- [x] Build and verify DMG output

## Acceptance Criteria

### Functional Requirements
- [ ] Can open any .md file via file picker button
- [ ] Files over 50KB are rejected with clear error message
- [ ] Markdown renders correctly in preview panel (no raw HTML execution)
- [ ] Play button reads the markdown content aloud
- [ ] Pause/resume works mid-speech
- [ ] Stop resets playback state
- [ ] Speed slider adjusts from 0.5x to 2x (takes effect on next play)
- [ ] Voice dropdown shows installed macOS voices
- [ ] "Transform" sends content to OpenAI with selected prompt
- [ ] Transformed content displayed and cached for session
- [ ] Can choose to read original or transformed content
- [ ] Preset and custom transformation prompts work correctly
- [ ] App launches without errors on macOS

### Security Requirements
- [ ] contextIsolation enabled, nodeIntegration disabled, sandbox enabled
- [ ] CSP configured and enforced
- [ ] Voice names validated against allowlist
- [ ] TTS rate validated as integer in range
- [ ] API key encrypted via safeStorage, never in renderer
- [ ] No shell:true in any spawn call
- [ ] say process cleaned up on quit

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| SIGSTOP/SIGCONT may behave unexpectedly | Test on current macOS; fallback to chunk-based pause |
| OpenAI API costs | 50KB file limit + gpt-4o-mini |
| User needs API key | Clear first-use prompt dialog |
| electron-vite breaking changes | Pin versions |
| Malformed markdown crashes strip-markdown | Wrap in try/catch, show error |

## References

- Brainstorm: `docs/brainstorms/2026-03-22-md-reader-brainstorm.md`
- [electron-vite](https://electron-vite.org/)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [strip-markdown](https://github.com/remarkjs/strip-markdown)
- [OpenAI Node.js SDK](https://github.com/openai/openai-node)
- [macOS say command](https://ss64.com/mac/say.html)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
