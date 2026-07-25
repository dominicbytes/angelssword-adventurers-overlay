# VeadoTube Mini Importer

Standalone Windows-first importer foundation for AS Adventurer Byte Edition.
Version 0.2.0 is deliberately inspect-only: it validates the `VEADOTUBE` header,
walks bounded chunk framing, identifies Mini (`MLST`) and dynamic (`DART`)
containers, and emits a deterministic JSON inventory and source hash. For Mini
avatars it also reports states, image/frame metadata, texture formats, flags,
effects, transitions, shortcuts, and reference failures.

It does not extract artwork, write model folders, or launch VeadoTube Mini.
`.vaedo` is accepted as a warned alias after content validation; `.veado` remains
the documented extension. Legacy ZIP containers and malformed or excessive
lengths produce structured errors with byte offsets.

```console
node inspect.js path\to\avatar.veado
npm test
```

The next phase will decode supported texture payloads and produce a mapping plan
before any stage/commit writer is added.
