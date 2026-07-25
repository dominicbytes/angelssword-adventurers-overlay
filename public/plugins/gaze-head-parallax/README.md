# Gaze and Head Parallax

Standalone Windows-first plugin for AS Adventurer Byte Edition. It converts the
core MediaPipe face landmarks into bounded gaze, head-position, and head-roll
motion, then contributes that motion without replacing other plugin transforms.

## Byte Edition interface

- The control entry point consumes the local `tracking-frame` event from
  `ASAPluginHost` version 1.
- It sends only bounded plugin state through `sendPluginEvent()`.
- The overlay entry point owns the `gaze-head-parallax` compositor channel through
  `setMotionContribution()` and `clearMotionContribution()`.

The plugin never calls `getUserMedia()`, starts an inference loop, accesses the
core WebSocket, or writes the avatar transform directly. Face tracking remains
owned by the webcam pipeline introduced through upstream PR 1.

## Behavior

- The first valid face frame provides a temporary neutral baseline.
- **Calibrate neutral pose** persists an explicit baseline for the current camera
  position.
- Iris landmarks add gaze motion when available; head parallax continues without
  them.
- Steady tracking updates are limited to 20 Hz. Face-loss and reacquisition edges
  bypass that throttle.
- Overlay motion smooths toward the target and decays to neutral after 300 ms
  without an update.

## Test

```console
npm test
```
