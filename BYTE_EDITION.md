# AS Adventurer Byte Edition

Byte Edition is an integration distribution maintained in the
`dominicbytes/angelssword-adventurers-overlay` fork. It keeps upstream history
traceable while providing the stable seams required by independently released
plugins.

Current prerelease version: `0.2.0-byte.1`.

## Integrated upstream work

The initial Byte Edition baseline includes every open upstream pull request as
of 2026-07-23:

- PR 1: MediaPipe-first webcam tracking, landmark geometry, gains, calibration,
  privacy controls, and release workflow.
- PR 3: external animation lifecycle HTTP/WebSocket interface.
- PR 4: trusted local browser plugin host.
- PR 5: WebSocket backpressure protection.
- PRs 6–9: failed-media, emote, worker URL, and audio cleanup.
- PR 10: UDP source filtering and rate limiting.

Fork security work also renders emote names as text, vendors the MediaPipe
runtime/model, and applies a Content Security Policy. Cross-PR integration routes
lifecycle initialization and plugin replay through the guarded sender.

## Byte Edition seams

Plugins should depend only on documented host interfaces:

- Plugin events and shared audio through `ASAPluginHost` version 1.
- Named actions for input plugins, including expression set and clear operations.
- Named, composable motion contributions.
- Local sanitized tracking-frame subscriptions.
- The shared tracking processor scheduler for future camera processors.
- Namespaced plugin processor registration without exposing webcam lifecycle
  ownership.

The webcam has one owner, one MediaPipe face processor, one animation scheduler,
and one control WebSocket. Plugins must not open duplicate media streams or
overwrite the avatar transform directly.

## Standalone plugin convention

Bundled plugins live in `public/plugins/<plugin-id>/`. Each folder is a complete
repository candidate and must contain:

- `plugin.json` for runtime discovery.
- `package.json` with its independent semantic version and test command.
- `README.md` documenting Byte Edition interface requirements.
- Browser entry points and assets owned by that plugin.
- Behavioral tests beneath the plugin folder.

A plugin may use Byte Edition interfaces but must not import another bundled
plugin's implementation. This allows the folder to be split into its own Git
repository without rewriting its source.

## Plugin status

- Reactive Motion Effects: validated schema migration, temporary preview,
  Windows reduced-motion handling, reconnect replay, 20 Hz audio publication,
  and duplicate-frame prevention included at version `0.2.0`.
- Universal Input Mapper: keyboard foundation complete at version `0.2.0` with
  multiple mappings, contexts, press/hold/toggle modes, conflicts, and import/export.
- OBS Scene-Aware Profiles: OBS WebSocket 5.x client, scene/action profiles,
  local-only configuration, host actions, reconnects, collection-change pauses,
  and backpressure protection included at version `0.1.0`. Mock protocol tests
  are complete. The local OBS 32.2.0 checkout contains obs-websocket 5.7.4
  source, but its current lite build does not contain the plugin DLL, so the
  live compatibility run remains pending a WebSocket-enabled OBS build.
- Gaze and Head Parallax: shared-frame landmark measurement, iris-aware gaze,
  head-position and roll parallax, persisted calibration, 20 Hz transport
  limiting, stale-frame decay, and composable overlay motion included at version
  `0.1.0`.
- Hand Gesture Triggers: shared-scheduler MediaPipe recognition, gesture-edge
  press/release actions, confidence and cooldown controls, validated local
  mappings, and a bundled official model included at version `0.1.0`.
- Props, Tossables, and Particles: reconnect-safe snapshot protocol, named
  spawn/hold/release/clear actions, bounded effect counts, timed cleanup,
  transparent placeholder art, and control previews included at version `0.1.0`.
- Rule Graph and Sequencer: validated manual action-graph slice included at
  version `0.1.0`; triggers and visual editing remain pending.
- VeadoTube Mini Importer: bounded inventory, Mini metadata decoding, streamed
  `RAW.`/`VDD.` RGBA decoding, explicit dry-run state mapping, static canvas
  composition, deterministic PNG encoding, validated previews, explicit local
  mapping confirmation, and a collision-safe stage/validate/commit writer
  included at version `0.5.0`; animated output remains pending.

## Next implementation pass

The next pass targets Windows only. Placeholder artwork is approved for props,
tossables, and particles. Plugins remain bundled as standalone repository
candidates until their first stable integration slices are complete; separate
GitHub repositories will be created later.

Implementation order:

1. Run the final OBS Scene-Aware Profiles live check once the local OBS build
   includes obs-websocket. Mock authentication, lifecycle, reconnect, and
   backpressure coverage is complete.
2. Select and validate a lossless browser-compatible animated output strategy
   before enabling animated VeadoTube imports. The static importer is complete:
   its preview hashes and transactional model output are verified against the
   private fixture without adding that source or its artwork to Git.

Private VeadoTube `.vaedo` and `.veado` fixtures belong under the ignored
`.private-fixtures/` directory inside the Byte Edition repository unless their
owner explicitly authorizes redistribution. Public synthetic fixtures may remain
tracked elsewhere. VaedoTube Mini, OBS, development servers, and plugin runtimes
are started manually during the next work session; this setup does not launch them.
