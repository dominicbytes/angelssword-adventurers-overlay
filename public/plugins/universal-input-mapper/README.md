# Universal Input Mapper

Standalone Byte Edition plugin that maps normalized keyboard edges to registered
actions. Version 0.2.0 supports multiple bindings, named contexts, press/hold/toggle
modes, optional release actions, conflict detection, and JSON import/export.

Configuration is declarative and persisted with `schemaVersion: 2`. Existing
schema-v1 configurations migrate automatically. Bindings in the `global` context
are active by default; `*` can be used by programmatic integrations that need a
binding in every context. Conflicting keys in the same or wildcard-overlapping
context are rejected without replacing the last valid configuration.

The plugin does not send WebSocket messages, click core controls, or inspect
overlay DOM. Gamepad and Web MIDI adapters remain planned after the keyboard
foundation.

## Byte Edition interface requirements

This plugin requires `window.ASAPluginHost` version 1 with `listActions()` and
`invokeAction(actionId, parameters)`. It discovers actions only through that
host contract and does not import Byte Edition implementation files.

Browser startup exposes `window.ASUniversalInputMapper`. Integrations can call
`setContext(name)` to activate a named mapping context; the control panel exposes
the same setting. Changing context, disabling mappings, importing configuration,
or destroying the controller releases active hold/toggle actions first.

## Test

```console
npm test
```
