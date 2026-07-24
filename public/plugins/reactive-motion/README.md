# Reactive Motion Effects

Standalone browser plugin for AS Adventurer Byte Edition. It adds bounded idle
breathing and microphone-reactive motion without replacing transforms from gaze
or other plugins.

## Byte Edition interface

- `ASAPluginHost.getAudioInput()` supplies the already-authorized microphone node.
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

