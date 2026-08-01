# ml

Computer-vision arrow detection. **Phase 2+ — not required for the MVP.**

## Scope

- Target face and arrow detection from a round photo
- Producing normalized (x, y) arrow positions — the *same* output the manual
  tap-to-mark flow produces
- Training, evaluation, and dataset tooling
- Export for on-device inference, plus a backend fallback path

## Why no schema change is needed

`rounds.photo_key` and the `arrows` x/y columns already accommodate CV: detection
just fills in the arrow rows a person would otherwise tap. Scoring still runs
on-device against `target_zones`. Adding detection changes how arrows get created,
not what gets stored.

## Deployment intent

Inference runs **on-device** where the hardware (NPU) allows. A capability check
falls back to a backend inference endpoint only when a device can't perform it
acceptably — consistent with the architecture principle in the
[root README](../README.md).

## Conventions

- Datasets and model weights are **not** committed. They're gitignored; document
  where they actually live.
- Every experiment worth keeping gets a note in [`docs/`](../docs/) — including
  the ones that failed, and why.
