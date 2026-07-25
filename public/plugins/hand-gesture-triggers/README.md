# Hand Gesture Triggers

Standalone Windows-first plugin for AS Adventurer Byte Edition. It recognizes
MediaPipe's canned hand gestures and invokes named host actions on gesture edges.

## Byte Edition interface

- Requires `ASAPluginHost` version 1 and its shared tracking processor registry.
- Uses the core webcam video and scheduler; it never calls `getUserMedia()` or
  starts its own animation loop.
- Invokes actions exposed by Byte Edition or another installed plugin.
- Loads the MediaPipe runtime and gesture model from local plugin assets.

The bundled `gesture_recognizer.task` is Google's official MediaPipe model from
`https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task`.
Its SHA-256 is
`a966b1d4e774e0423c19c8aa71f070e5a72fe7a03c2663dd2f3cb0b0095ee3e1`.
The plugin-owned MediaPipe Tasks Vision runtime is documented with its source,
integrity, and Apache-2.0 license under `vendor/mediapipe/`.

## Configuration

The control panel accepts an array of mappings. Each gesture may appear once.
A press action is required and a release action is optional:

```json
[
  {
    "gesture": "Thumb_Up",
    "press": {
      "actionId": "state.set",
      "parameters": { "state": "happy" }
    },
    "release": {
      "actionId": "state.clear",
      "parameters": {}
    }
  }
]
```

Supported gestures are `Closed_Fist`, `Open_Palm`, `Pointing_Up`, `Thumb_Down`,
`Thumb_Up`, `Victory`, and `ILoveYou`. A held pose fires once. The optional
release action fires when the detected gesture changes or disappears. Cooldown
prevents rapid re-entry from retriggering the same gesture.

Configuration remains in browser-local storage. No camera frames or gesture
results leave the application.

## Test

```console
npm test
```
