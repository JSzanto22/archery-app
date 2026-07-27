# archery-app

Archery training app with computer-vision shot analysis.

## Repository layout

```
archery-app/
├── mobile/          # React Native/Flutter/Swift/Kotlin app
├── backend/         # API, Lambda functions, etc.
├── ml/              # CV model code (added later, Phase 2+)
├── docs/            # architecture notes, README, failure logs
└── README.md
```

| Directory | Purpose |
| --- | --- |
| [`mobile/`](mobile/) | Client application — capture, review, and score sessions on device. |
| [`backend/`](backend/) | API surface, serverless functions, persistence, auth. |
| [`ml/`](ml/) | Computer-vision model code: training, evaluation, inference packaging. Phase 2+. |
| [`docs/`](docs/) | Architecture notes, decision records, failure logs. |

Each directory has its own `README.md` describing what belongs there.

## Getting started

Nothing is implemented yet — this is the scaffold. Pick a directory and read its
README for the conventions that apply there.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Mobile capture + backend session storage | Not started |
| 2 | CV model for arrow/target detection | Not started |
