import { useState, useEffect, useCallback } from 'react'
import { remark } from 'remark'
import strip from 'strip-markdown'
import MarkdownPreview from './components/MarkdownPreview'
import PlaybackControls from './components/PlaybackControls'
import TransformPanel from './components/TransformPanel'
import './App.css'

type TtsState = 'stopped' | 'playing' | 'paused' | 'finished' | 'error'

function App(): React.JSX.Element {
  // File state
  const [filePath, setFilePath] = useState<string | null>(null)
  const [rawContent, setRawContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  // TTS state
  const [ttsState, setTtsState] = useState<TtsState>('stopped')
  const [selectedVoice, setSelectedVoice] = useState('')
  const [speed, setSpeed] = useState(1)
  const [voices, setVoices] = useState<{ name: string; locale: string }[]>([])

  // Transform state
  const [transformedContent, setTransformedContent] = useState<string | null>(null)
  const [readTransformed, setReadTransformed] = useState(false)
  const [isTransforming, setIsTransforming] = useState(false)
  const [transformError, setTransformError] = useState<string | null>(null)
  const [hasApiKey, setHasApiKey] = useState(false)

  // Load voices on mount
  useEffect(() => {
    window.api.listVoices().then((v) => {
      setVoices(v)
      if (v.length > 0) {
        // Prefer Samantha, fall back to first voice
        const samantha = v.find((voice) => voice.name === 'Samantha')
        setSelectedVoice(samantha ? samantha.name : v[0].name)
      }
    })
    window.api.hasApiKey().then(setHasApiKey)
  }, [])

  // Listen for TTS state changes from main process
  useEffect(() => {
    window.api.onTtsStateChanged((data) => {
      setTtsState(data.state)
      if (data.error) {
        setError(data.error)
      }
    })
    // Listen for Cmd+O file opens from menu
    window.api.onFileOpened((data) => {
      if (data.success && data.content) {
        setRawContent(data.content)
        setFilePath(data.filePath || null)
        setTransformedContent(null)
        setReadTransformed(false)
        setError(null)
        setTransformError(null)
      } else if (data.error && data.error !== 'Cancelled') {
        setError(data.error)
      }
    })
  }, [])

  // Convert markdown to plain text for TTS
  const markdownToText = useCallback(async (md: string): Promise<string> => {
    try {
      const file = await remark().use(strip).process(md)
      let text = String(file)
      // Clean up table formatting for TTS (strip-markdown leaves tables as-is)
      text = text.replace(/\|[-:| ]+\|/g, '') // remove separator rows like |---|---|
      text = text.replace(/\|/g, ', ') // replace pipes with commas
      text = text.replace(/, ,/g, ',') // clean up double commas
      text = text.replace(/\n{3,}/g, '\n\n') // collapse excess newlines
      return text.trim()
    } catch {
      return md // fallback to raw content
    }
  }, [])

  // Speed to WPM mapping
  const speedToWpm = (s: number): number => {
    // Linear interpolation: 0.5x=90, 1x=175, 2x=350
    return Math.round(90 + (s - 0.5) * ((350 - 90) / (2 - 0.5)))
  }

  // Handlers
  const handleOpenFile = async (): Promise<void> => {
    const result = await window.api.openFile()
    if (result.success && result.content) {
      setRawContent(result.content)
      setFilePath(result.filePath || null)
      setTransformedContent(null)
      setReadTransformed(false)
      setError(null)
      setTransformError(null)
    } else if (result.error && result.error !== 'Cancelled') {
      setError(result.error)
    }
  }

  const handlePlay = async (): Promise<void> => {
    if (ttsState === 'paused') {
      await window.api.resumeSpeech()
      return
    }

    const contentToRead = readTransformed && transformedContent ? transformedContent : rawContent

    if (!contentToRead) return

    const text =
      readTransformed && transformedContent
        ? transformedContent // already plain text from OpenAI
        : await markdownToText(contentToRead)

    const wpm = speedToWpm(speed)
    await window.api.speak(text, selectedVoice, wpm)
  }

  const handlePause = async (): Promise<void> => {
    await window.api.pauseSpeech()
  }

  const handleStop = async (): Promise<void> => {
    await window.api.stopSpeech()
  }

  const handleTransform = async (prompt: string): Promise<void> => {
    if (!rawContent) return
    setIsTransforming(true)
    setTransformError(null)

    const result = await window.api.transform(rawContent, prompt)

    setIsTransforming(false)
    if (result.success && result.result) {
      setTransformedContent(result.result)
      setReadTransformed(true)
    } else {
      setTransformError(result.error || 'Transformation failed.')
    }
  }

  const handleSaveApiKey = async (key: string): Promise<boolean> => {
    const result = await window.api.saveApiKey(key)
    if (result.success) {
      setHasApiKey(true)
      return true
    }
    return false
  }

  const fileName = filePath ? filePath.split('/').pop() : null
  const isPlaying = ttsState === 'playing'
  const isPaused = ttsState === 'paused'

  return (
    <div className="app">
      <header className="header">
        <h1>MD Reader</h1>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={handleOpenFile}>
            Open File
          </button>
          {fileName && <span className="file-name">{fileName}</span>}
        </div>
      </header>

      {error && (
        <div className="error-banner">
          {error}
          <button className="error-dismiss" onClick={() => setError(null)}>
            &times;
          </button>
        </div>
      )}

      <main className="main">
        {!rawContent ? (
          <div className="empty-state">
            <p>Open a markdown file to get started.</p>
            <p className="hint">Use the button above or Cmd+O</p>
          </div>
        ) : (
          <>
            <div className="content-area">
              <div className="preview-section">
                <div className="section-header">
                  {transformedContent && (
                    <div className="toggle-group">
                      <button
                        className={`toggle-btn ${!readTransformed ? 'active' : ''}`}
                        onClick={() => setReadTransformed(false)}
                      >
                        Original
                      </button>
                      <button
                        className={`toggle-btn ${readTransformed ? 'active' : ''}`}
                        onClick={() => setReadTransformed(true)}
                      >
                        Transformed
                      </button>
                    </div>
                  )}
                </div>
                <div className="preview-content">
                  {readTransformed && transformedContent ? (
                    <div className="transformed-text">{transformedContent}</div>
                  ) : (
                    <MarkdownPreview content={rawContent} />
                  )}
                </div>
              </div>

              <div className="transform-section">
                <TransformPanel
                  onTransform={handleTransform}
                  isTransforming={isTransforming}
                  error={transformError}
                  hasApiKey={hasApiKey}
                  onSaveApiKey={handleSaveApiKey}
                  hasContent={!!rawContent}
                />
              </div>
            </div>

            <PlaybackControls
              isPlaying={isPlaying}
              isPaused={isPaused}
              voices={voices}
              selectedVoice={selectedVoice}
              speed={speed}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
              onVoiceChange={setSelectedVoice}
              onSpeedChange={setSpeed}
              hasContent={!!rawContent}
            />
          </>
        )}
      </main>
    </div>
  )
}

export default App
