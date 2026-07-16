# Viseme Lip Sync Plugin

This optional plugin adds local microphone-driven mouth-shape detection to AS Adventurer. It groups detected sounds into four animated shapes plus rest:

- `closed` for P/B/M-style pressed lips;
- `open` for open vowels;
- `wide` for spread vowels and most consonants;
- `round` for O/U-style rounded lips;
- `rest` returns to the normal idle animation.

## Model files

Add these files to a model folder, using any supported image/video extension:

```text
neutral_viseme_closed.webm
neutral_viseme_open.webm
neutral_viseme_wide.webm
neutral_viseme_round.webm
```

Expression-specific versions are optional, for example `happy_viseme_open.webm` or `sad_viseme_round.webm`. If a viseme asset is missing, the plugin falls back to the existing expression's `*_speaking` asset, then the neutral viseme or `neutral_speaking`.

All loop variants should have the same dimensions, FPS, frame count, duration, loop point, and non-mouth motion. Phase-aligned variants produce the least visible jumping.

## Runtime

Enable the microphone in the normal Control Panel. The plugin appears beneath the Microphone card and starts automatically when enabled. Detection runs locally in the browser; no microphone audio leaves the machine.

The detector is based on HeadAudio at commit `d3af5f9ff86ab6b2b1913d411a4e1922ec101953`. See `THIRD_PARTY.md` and `vendor/HEADAUDIO-LICENSE.txt`.
