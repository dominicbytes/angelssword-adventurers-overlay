# OBS Scene-Aware Profiles

Standalone Windows-first Byte Edition plugin that maps OBS program scenes to
named host actions. Version 0.1.0 supports OBS WebSocket 5.x authentication,
initial scene discovery, scene-change events, validated local profiles, bounded
reconnects, collection-change pauses, and backpressure protection.

The OBS password is kept in memory only and is never written to local storage.
WebSocket URLs are restricted to `localhost`, `127.0.0.1`, or `::1`. The default
port is OBS WebSocket 5.x port `4455`.

## Byte Edition interface requirements

This plugin requires `window.ASAPluginHost` version 1 with `registerAction()` and
`invokeAction()`. It registers `obs.scene.set` and `obs.profile.reapply`, while
scene profiles invoke only named host actions. It does not access the core
WebSocket or import another plugin's implementation.

## Configuration

Profiles use `schemaVersion: 1`:

```json
{
  "schemaVersion": 1,
  "url": "ws://localhost:4455",
  "profiles": [
    {
      "sceneName": "Gameplay",
      "actions": [
        { "actionId": "state.set", "parameters": { "state": "happy" } }
      ]
    }
  ]
}
```

The control panel edits the `profiles` array separately and stores the URL with
the validated configuration. OBS remains responsible for its own scene names and
authentication settings.

Protocol reference: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md

## Test

```console
npm test
```
