# Viseme Lip Sync Plugin

This optional plugin adds local microphone-driven mouth-shape detection to AS Adventurer. Version 2 supports both complete mouth-loop videos and transparent mouth sprites composited over a mouth-neutral body loop. It groups detected sounds into four animated shapes plus rest:

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

## Optional sprite mode

Sprite mode eliminates duplicate body videos. Keep the normal expression videos mouth-neutral, then add this folder to the model:

```text
MyCharacter/
  neutral_idle.webm
  neutral_speaking.webm
  viseme/
    manifest.json
    sprites/
      neutral/
        closed.png
        open-1.png
        open-2.png
        open-3.png
        wide-1.png
        wide-2.png
        wide-3.png
        round-1.png
        round-2.png
        round-3.png
```

Copy `examples/viseme/manifest.json` from the add-on as a starting point. Sprite paths are relative to the `viseme/` folder. The neutral set must provide closed, open, wide, and round. Expression sets such as `sprites.happy` are optional and fall back to neutral.

`mouth.size` is the rendered sprite size in source-video pixels. Each anchor contains:

- `x`, `y`: mouth center in source-video pixels;
- `scale`: uniform scale;
- `rotation`: radians;
- `scaleX`: horizontal foreshortening.

An anchor may be one fixed object or an array with one entry per animation frame. Arrays use `fps` and the active video's playback time. State-specific entries such as `neutral_speaking` override `default`.

Add `?debugmouth=1` to the overlay URL to outline the sprite and show its shape, openness, and frame.

## Runtime

Enable the microphone in the normal Control Panel. The plugin appears beneath the Microphone card and starts automatically when enabled. Detection runs locally in the browser; no microphone audio leaves the machine.

The openness meter controls sprite intensity levels. **Calibrate voice** records silence plus sustained “aaah,” “eeee,” and “ohhh” samples in the current browser; calibrated MFCC templates replace the generic vowel grouping while HeadAudio continues handling consonants. The shape buttons provide a no-microphone test mode.

The detector is based on HeadAudio at commit `d3af5f9ff86ab6b2b1913d411a4e1922ec101953`. The optional calibration fingerprint is adapted from VTuberAvatarStudio. See `THIRD_PARTY.md` and the licenses under `vendor/`.
