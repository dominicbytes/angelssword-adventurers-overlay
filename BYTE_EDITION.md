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
- Universal Input Mapper: action-registry foundation next.
- OBS Scene-Aware Profiles: planned against lifecycle PR 3 and backpressure PR 5.
- Gaze and Head Parallax: tracking seam ready; plugin implementation pending.
- Hand Gesture Triggers: tracking processor seam ready; implementation pending.
- Props, Tossables, and Particles: motion/overlay seam partially ready.
- Rule Graph and Sequencer: pending action registry.
- VeadoTube Mini Importer: independently implementable; fixture-driven work pending.
