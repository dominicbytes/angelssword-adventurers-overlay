# Viseme Lip Sync Add-on

## Install

1. Use a plugin-capable AS Adventurer release containing `public/plugin-host.js`.
2. Place the `Viseme Lip Sync Addon` folder anywhere inside the AS Adventurer folder.
3. Double-click `Install Viseme Lip Sync.bat`.
4. Restart AS Adventurer.
5. Add either the four optional neutral viseme videos or a `viseme/manifest.json` sprite set described in `plugin/README.md` to your model.
6. Enable the normal microphone in the Control Panel.

Installing over an existing copy backs it up under `plugin-backups/` first.

The add-on includes `examples/viseme/manifest.json` as a fixed-anchor sprite-mode starter. Use the Control Panel shape buttons to test without a microphone, or enable the mic and run **Calibrate voice** for personalized vowel matching.

## Uninstall

Double-click `Uninstall Viseme Lip Sync.bat`, then restart AS Adventurer. Uninstalling moves the plugin into `plugin-backups/` rather than deleting it.
