import { useState } from 'react'

interface Props {
  onTransform: (prompt: string) => Promise<void>
  isTransforming: boolean
  error: string | null
  hasApiKey: boolean
  onSaveApiKey: (key: string) => Promise<boolean>
  hasContent: boolean
}

const PRESETS = [
  {
    label: '6th Grader',
    prompt: "Explain this like I'm a 6th grader. Use simple words and short sentences."
  },
  {
    label: 'Fairytale',
    prompt:
      'Rewrite this as an engaging fairytale narrative for adults. Make it entertaining but preserve all the information.'
  },
  {
    label: 'Executive Summary',
    prompt: 'Rewrite this as a concise executive summary. Use clear, professional language.'
  },
  {
    label: 'Podcast Script',
    prompt:
      'Rewrite this as a conversational podcast script, as if explaining to a listener. Be engaging and natural.'
  }
]

function TransformPanel({
  onTransform,
  isTransforming,
  error,
  hasApiKey,
  onSaveApiKey,
  hasContent
}: Props): React.JSX.Element {
  const [customPrompt, setCustomPrompt] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showApiKeyInput, setShowApiKeyInput] = useState(!hasApiKey)

  const handleSaveKey = async (): Promise<void> => {
    if (!apiKeyInput.trim()) return
    const success = await onSaveApiKey(apiKeyInput.trim())
    if (success) {
      setShowApiKeyInput(false)
      setApiKeyInput('')
    }
  }

  const handleCustomTransform = (): void => {
    if (customPrompt.trim()) {
      onTransform(customPrompt.trim())
    }
  }

  if (showApiKeyInput) {
    return (
      <div className="transform-panel">
        <h3>AI Transform</h3>
        <p className="hint">Enter your OpenAI API key to enable content transformation.</p>
        <div className="api-key-form">
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="sk-..."
            className="api-key-input"
            onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
          />
          <button className="btn btn-primary" onClick={handleSaveKey}>
            Save Key
          </button>
          {hasApiKey && (
            <button className="btn btn-text" onClick={() => setShowApiKeyInput(false)}>
              Cancel
            </button>
          )}
        </div>
        <p className="hint">Your key is encrypted and stored locally.</p>
      </div>
    )
  }

  return (
    <div className="transform-panel">
      <div className="transform-header">
        <h3>AI Transform</h3>
        <button
          className="btn btn-text"
          onClick={() => setShowApiKeyInput(true)}
          title="Change API key"
        >
          Key
        </button>
      </div>

      <div className="preset-buttons">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            className="btn btn-preset"
            onClick={() => onTransform(preset.prompt)}
            disabled={isTransforming || !hasContent}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="custom-prompt">
        <textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder='Try: "Explain this like a bedtime story" or "Make this funny"'
          rows={2}
          className="prompt-input"
        />
        <button
          className="btn btn-primary"
          onClick={handleCustomTransform}
          disabled={isTransforming || !hasContent || !customPrompt.trim()}
        >
          Transform
        </button>
      </div>

      {isTransforming && (
        <div className="transform-loading">
          <span className="spinner" />
          Transforming...
        </div>
      )}

      {error && <div className="transform-error">{error}</div>}
    </div>
  )
}

export default TransformPanel
