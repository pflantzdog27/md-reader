# MD Reader — Brainstorm

**Date:** 2026-03-22
**Status:** Decided — ready for planning

## What We're Building

A macOS desktop app that reads markdown files aloud. Core capabilities:

1. **Direct reading** — Load any `.md` file and have it read aloud as-is via macOS system TTS
2. **Speed control** — Adjustable playback from 0.5x to 2x
3. **Voice selection** — Choose from macOS built-in system voices
4. **AI transformation** — Before reading, optionally transform the content through OpenAI:
   - "Explain like I'm a 6th grader"
   - "Turn this into a fairytale narrative"
   - Custom user prompts
   - The transformed version must preserve all key information from the original
5. **File size limit** — Cap accepted files to prevent runaway API costs on huge docs

## Why This Approach

- **Electron + React**: Mature, fast to build, huge ecosystem. macOS-only simplifies packaging.
- **macOS system TTS (NSSpeechSynthesizer via say command or native bindings)**: Free, offline, no API costs for speech. Good enough quality for reading docs.
- **OpenAI API for transformations**: User preference. Good at creative rewriting.
- **File size limit instead of chunking**: Keeps v1 simple. No streaming complexity, no partial-transform state management.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Platform | macOS only | Simplicity, user's primary OS |
| Desktop framework | Electron + React | Mature, fast dev, good ecosystem |
| TTS engine | macOS system voices | Free, offline, sufficient quality |
| AI provider | OpenAI API | User preference for transformations |
| Long doc handling | File size limit | Avoid complexity of chunking/streaming |
| Voice options | System voices only | No cloud TTS needed for v1 |

## MVP Scope

- File picker to load `.md` files
- Markdown preview panel (rendered)
- Play/pause/stop controls
- Speed slider (0.5x–2x)
- Voice dropdown (system voices)
- "Transform" mode: text input for custom prompt + presets
- Transformed content preview before reading
- File size limit with clear error message

## Open Questions

- Exact file size limit (suggestion: ~50KB / ~10,000 words)
- Whether to show original + transformed side-by-side or toggle between them
- OpenAI model choice (gpt-4o vs gpt-4o-mini for cost savings)
- Whether to cache transformations for re-reading

## Out of Scope (v1)

- Windows/Linux support
- Cloud TTS voices
- Local LLM support
- Batch processing multiple files
- Export transformed text
- Streaming/chunked transformation
