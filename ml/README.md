# ml

Computer-vision model code. **Phase 2+ — not needed for the first release.**

## Scope

- Target face and arrow detection
- Shot-to-score mapping from detected impact points
- Training, evaluation, and dataset tooling
- Export/packaging for serving from [`backend/`](../backend/) or on-device in
  [`mobile/`](../mobile/)

## Conventions

- Datasets and model weights are **not** committed to git. Keep them out via
  `.gitignore` and document where they actually live.
- Every experiment worth keeping gets a note in [`docs/`](../docs/) — including
  the ones that failed, and why.
