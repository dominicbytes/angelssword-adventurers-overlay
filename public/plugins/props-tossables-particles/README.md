# Props, Tossables, and Particles

Standalone Windows-first overlay-effects plugin for AS Adventurer Byte Edition.
Version 0.1.0 provides placeholder star prop, tossed star, and confetti presets.

## Byte Edition interface

Requires `ASAPluginHost` version 1. The control entry point uses
`registerAction()`, `sendPluginEvent()`, `on()`, and `isTransportOpen()`. The
overlay entry point uses `on()` to reconcile snapshot events. It does not import
another bundled plugin or access the core WebSocket directly.

It registers `effects.spawn`, `effects.hold`, `effects.release`, and
`effects.clear` host actions. Every change publishes a complete snapshot rather
than a transient command, so overlay reconnect replay reconciles existing effect
IDs without duplicating them. Active effects are capped and timed effects are
removed from both the control snapshot and overlay.

The plugin uses no camera, microphone, direct WebSocket, or avatar transform.
Replace the SVG files under `assets/` to customize the placeholder artwork.

```console
npm test
```
