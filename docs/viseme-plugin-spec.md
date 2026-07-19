# Viseme Lip Sync Plugin Specification

## Goal

Add optional, local microphone-driven lip sync without turning the detector into a required part of AS Adventurer.

## Acceptance criteria

- The add-on installs by copying one plugin directory into `public/plugins/` and can be removed without changing core files.
- The existing control-panel microphone stream is shared with the plugin; the plugin does not request a second microphone.
- Detection runs locally and emits only `rest`, `closed`, `open`, `wide`, or `round` events to the overlay.
- The overlay prefers an expression-specific viseme asset, keeps the expression's normal speaking loop when that viseme asset is absent, then falls back to a neutral viseme or neutral speaking asset.
- Sibling viseme videos remain phase-aligned while swapping visibility to minimize body-motion jumps.
- Disabling or uninstalling the plugin retains the original idle/speaking behavior.
- A distributable ZIP includes the detector, model, third-party license, installers, and asset documentation.

## Version 2 acceptance criteria

- Existing full-video viseme models continue to work without configuration changes.
- Detector events include normalized mouth openness while retaining the five public shape names.
- The control panel provides a no-microphone shape test and an optional local voice-calibration flow.
- A model may opt into sprite mode with `viseme/manifest.json`; missing or invalid manifests fall back to full-video mode.
- Sprite mode keeps the base expression video active and draws only the selected transparent mouth sprite above it.
- Sprite manifests can define multiple openness levels, expression-specific sprite sets, and per-frame mouth anchors.
- Anchor lookup follows the active video's playback position and supports position, scale, rotation, and horizontal foreshortening.
- Debug mode can outline the mouth sprite bounds and report its active shape/openness level.
