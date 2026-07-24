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

- Reactive Motion Effects: first working slice included at version `0.1.0`.
- Universal Input Mapper: first keyboard-to-action slice included at version `0.1.0`.
- OBS Scene-Aware Profiles: planned against lifecycle PR 3 and backpressure PR 5.
- Gaze and Head Parallax: tracking seam ready; plugin implementation pending.
- Hand Gesture Triggers: tracking processor seam ready; implementation pending.
- Props, Tossables, and Particles: motion/overlay seam partially ready.
- Rule Graph and Sequencer: action-registry seam ready; implementation pending.
- VeadoTube Mini Importer: independently implementable; fixture-driven work pending.

## Next implementation pass

The next pass targets Windows only. Placeholder artwork is approved for props,
tossables, and particles. Plugins remain bundled as standalone repository
candidates until their first stable integration slices are complete; separate
GitHub repositories will be created later.

Implementation order:

1. Finish the Universal Input Mapper foundation. Verify with persistence,
   conflict, held/toggle, and standalone-package tests.
2. Build Rule Graph and Sequencer on the shared action registry. Verify that
   invalid cycles are rejected and valid action chains execute deterministically.
3. Add OBS Scene-Aware Profiles through OBS WebSocket 5.x. Verify reconnect,
   authentication, lifecycle, and backpressure behavior against mocks and local OBS.
4. Add Gaze and Head Parallax through the shared webcam pipeline. Verify that it
   composes bounded motion without opening another camera stream.
5. Add Hand Gesture Triggers without opening a second webcam stream. Verify
   scheduler backpressure, gesture edges, cooldowns, and action invocation.
6. Add Props, Tossables, and Particles using placeholder artwork. Verify spawn,
   motion, cleanup, transparency, and overlay reconnect behavior.
7. Finish Reactive Motion Effects polish and presets. Verify configuration
   migration, preview, reduced motion, reconnect, and performance behavior.
8. Build the VeadoTube Mini Importer from private fixtures. Verify deterministic
   inspect-only output before extraction and confirm the source remains unchanged.

Private VeadoTube `.vaedo` and `.veado` fixtures belong under the ignored
`.private-fixtures/` directory inside the Byte Edition repository unless their
owner explicitly authorizes redistribution. Public synthetic fixtures may remain
tracked elsewhere. VaedoTube Mini, OBS, development servers, and plugin runtimes
are started manually during the next work session; this setup does not launch them.
