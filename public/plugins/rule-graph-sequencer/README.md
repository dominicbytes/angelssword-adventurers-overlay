# Rule Graph and Sequencer

Standalone Byte Edition plugin for validated, deterministic action sequences.
Version 0.1.0 provides the execution foundation: users can store directed acyclic
graphs of named actions, add bounded delays, validate JSON configuration, and run
enabled graphs manually from the control page.

Graphs are persisted with `schemaVersion: 1`. Invalid nodes, missing edges,
duplicate IDs, oversized graphs, and cycles are rejected without replacing the
last valid configuration. Ready nodes are ordered by ID so the same graph executes
deterministically. Execution stops on the first failed host action.

## Byte Edition interface requirements

This plugin requires `window.ASAPluginHost` version 1 and invokes behavior only
through `invokeAction(actionId, parameters)`. It does not click controls, access
the core WebSocket, or import another plugin's implementation.

Triggers, conditions, cooldowns, and a visual graph editor remain planned. The
0.1.0 slice is intentionally a manual sequencer and validation core.

## Test

```console
npm test
```
