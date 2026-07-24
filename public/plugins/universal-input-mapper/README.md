# Universal Input Mapper

Standalone Byte Edition plugin that maps normalized input edges to registered
actions. Version 0.1.0 is the first keyboard vertical slice: one browser-focused
keyboard binding can invoke `state.set` or `state.clear` through the host action
interface.

Configuration is declarative and persisted with `schemaVersion: 1`. The plugin
does not send WebSocket messages, click core controls, or inspect overlay DOM.
Gamepad, Web MIDI, multiple mappings, contexts, and import/export remain planned.

## Test

```console
npm test
```
