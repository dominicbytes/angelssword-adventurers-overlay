# VeadoTube Mini Importer

Standalone Windows-first importer foundation for AS Adventurer Byte Edition.
Version 0.4.0 remains deliberately read-only: it validates the `VEADOTUBE` header,
walks bounded chunk framing, identifies Mini (`MLST`) and dynamic (`DART`)
containers, and emits a deterministic JSON inventory and source hash. For Mini
avatars it also reports states, image/frame metadata, texture formats, flags,
effects, transitions, shortcuts, and reference failures.

The pure decoder converts documented `RAW.` and `VDD.` texture payloads to
top-down RGBA while enforcing per-texture and whole-document pixel budgets.
Referenced textures can be streamed one at a time. The mapping API accepts only
explicit state selections, produces deterministic AngelSword filenames, keeps
unmapped and unrepresentable blink assets in a review plan, and leaves all
effect and shortcut suggestions disabled. Normalized name matches are suggestions
that still require confirmation.

Static `AIMG` frames can now be composed on their transparent canvases, encoded
deterministically as non-interlaced RGBA8 PNGs, decoded again for lossless
validation, and streamed as in-memory previews with byte counts and SHA-256
hashes. Preview generation enforces filename, count, pixel, and byte budgets and
does not write model folders.

It does not extract artwork, write model folders, or launch VeadoTube Mini.
`.vaedo` is accepted as a warned alias after content validation; `.veado` remains
the documented extension. Legacy ZIP containers and malformed or excessive
lengths produce structured errors with byte offsets.

```console
node inspect.js path\to\avatar.veado
npm test
```

Animated images remain reported as unresolved until a lossless browser-compatible
encoder is selected. The next phase will add the collision-safe stage/validate/
commit workflow and local mapping-confirmation UI for supported static assets.
