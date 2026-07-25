# Reactive Motion Effects

Standalone browser plugin for AS Adventurer Byte Edition. It adds bounded idle
breathing and microphone-reactive motion without replacing transforms from gaze
or other plugins.

Version 0.2.0 migrates legacy settings into a validated schema, adds a temporary
preview, follows the Windows reduced-motion preference by default, restores its
state after reconnects, limits audio publication to 20 Hz, and avoids duplicate
animation-frame requests.

## Byte Edition interface

- The `audio-level` event supplies the core's existing normalized microphone analysis.
- `sendPluginEvent()` sends configuration and normalized level data to overlays.
- `setMotionContribution()` and `clearMotionContribution()` own only this plugin's
  named motion channel.

The plugin never requests microphone permission, opens a WebSocket, or writes the
overlay container's transform directly. The folder is self-contained so it can be
split into its own repository later.

## Test

```console
npm test
```
