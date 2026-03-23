interface Props {
  isPlaying: boolean
  isPaused: boolean
  voices: { name: string; locale: string }[]
  selectedVoice: string
  speed: number
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onVoiceChange: (voice: string) => void
  onSpeedChange: (speed: number) => void
  hasContent: boolean
}

const SPEED_MARKS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

function PlaybackControls({
  isPlaying,
  isPaused,
  voices,
  selectedVoice,
  speed,
  onPlay,
  onPause,
  onStop,
  onVoiceChange,
  onSpeedChange,
  hasContent
}: Props): React.JSX.Element {
  const canPlay = hasContent && !isPlaying
  const canPause = isPlaying && !isPaused
  const canResume = isPaused
  const canStop = isPlaying || isPaused

  return (
    <div className="playback-controls">
      <div className="controls-row">
        <div className="transport-controls">
          {canPause ? (
            <button className="btn btn-control" onClick={onPause} title="Pause">
              ⏸
            </button>
          ) : canResume ? (
            <button className="btn btn-control btn-play" onClick={onPlay} title="Resume">
              ▶
            </button>
          ) : (
            <button
              className="btn btn-control btn-play"
              onClick={onPlay}
              disabled={!canPlay}
              title="Play"
            >
              ▶
            </button>
          )}
          <button
            className="btn btn-control"
            onClick={onStop}
            disabled={!canStop}
            title="Stop"
          >
            ⏹
          </button>
        </div>

        <div className="speed-control">
          <label>Speed: {speed}x</label>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.25}
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            className="speed-slider"
          />
          <div className="speed-marks">
            {SPEED_MARKS.filter((_, i) => i % 2 === 0).map((mark) => (
              <span key={mark}>{mark}x</span>
            ))}
          </div>
        </div>

        <div className="voice-control">
          <label>Voice:</label>
          <select
            value={selectedVoice}
            onChange={(e) => onVoiceChange(e.target.value)}
            className="voice-select"
          >
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.locale})
              </option>
            ))}
          </select>
        </div>
      </div>

      {(isPlaying || isPaused) && (
        <div className="playback-status">
          {isPlaying ? 'Playing...' : 'Paused'}
        </div>
      )}
    </div>
  )
}

export default PlaybackControls
