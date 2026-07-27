# mobile

Client application for the archery app.

Framework is not yet chosen — React Native, Flutter, Swift, or Kotlin. Record the
decision in [`docs/`](../docs/) once it is made, then replace this note with real
setup instructions.

## Responsibilities

- Camera capture of shots and target faces
- Session review, scoring, and history
- Auth against [`backend/`](../backend/)
- On-device inference, if/when the [`ml/`](../ml/) models ship to the client

## Layout

Scaffolding lands here once the framework is picked. Keep platform-specific
project files at the root of this directory so standard toolchains work
unmodified.
