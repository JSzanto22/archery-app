# docs

Architecture notes, design decisions, and failure logs.

## Contents

| File / folder                                | Contents                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [`technical-design.md`](technical-design.md) | **MVP technical design** — Postgres schemas, API endpoints, per-screen data contracts, cloud integration. The reference document. |
| `decisions/`                                 | One file per significant decision — context, choice, consequences.                                                                |
| `failures.md`                                | Approaches that did not work, and why. Saves re-litigating them.                                                                  |

## Conventions

- Date every entry (`YYYY-MM-DD`) — relative dates rot.
- Write down the _why_, not just the _what_; the code already shows the what.
- A failed approach is worth as much as a successful one. Log it.
- When the technical design changes, update `technical-design.md` itself and note
  the reasoning in `decisions/` — don't let the two drift.
