# VeadoTube Mini Importer

Standalone Windows-first static model importer for AS Adventurer Byte Edition.
Version 0.5.0 validates modern VeadoTube Mini files, presents every state and
image role for local review, and installs only mappings the user explicitly
confirms.

## Run the local importer

From this directory:

```console
npm start
```

Then open `http://127.0.0.1:3010` in a browser. The command binds only to the
IPv4 loopback interface and does not launch a browser, VeadoTube Mini, OBS, or AS
Adventurer. The page accepts file bytes selected by the browser; it does not
accept an arbitrary filesystem path.

The confirmation page shows idle, speaking, blinking-idle, and
blinking-speaking artwork for each source state. Normalized name matches are
suggestions only. At least one mapping and the explicit confirmation checkbox
are required. Animated, unsupported, or oversized mapped artwork blocks the
import instead of producing a partial model. Effects and shortcut suggestions
remain disabled.

## Static import transaction

Supported `RAW.` and `VDD.` textures are decoded to top-down RGBA, composed on
their transparent canvases, encoded as deterministic non-interlaced RGBA8 PNGs,
and decoded again for lossless validation. Static previews are limited to eight
million canvas pixels each, with bounded file, count, and cumulative byte
budgets.

Confirmed PNGs and `.as-adventurer-import.json` are first written to a uniquely
created staging directory under `public/assets`. The importer validates the
exact file set, regular-file types, PNG structure, dimensions, byte lengths, and
SHA-256 hashes from disk. A validated stage becomes visible through one directory
rename. Existing model folders are never merged, replaced, or overwritten; a
collision leaves the existing folder unchanged and removes the importer's own
temporary stage.

## Inspection and tests

The read-only inventory command remains available:

```console
node inspect.js path\to\avatar.veado
npm test
```

The parser validates the `VEADOTUBE` header, walks bounded chunk framing, and
identifies Mini (`MLST`) and dynamic (`DART`) containers. For Mini avatars it
reports metadata, states, image/frame descriptors, texture formats, flags,
effects, transitions, shortcuts, and reference failures. `.vaedo` is accepted as
a warned alias after content validation; `.veado` remains the documented
extension. Legacy ZIP containers and malformed or excessive lengths produce
structured errors with byte offsets.

Animated images remain unresolved until a lossless browser-compatible encoder
is selected. Dynamic avatars, effects, shortcuts, and review-only blink variants
are not installed in version 0.5.0.
