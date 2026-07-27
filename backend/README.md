# backend

API, serverless functions, and data storage for the archery app.

## Responsibilities

- REST/GraphQL API consumed by [`mobile/`](../mobile/)
- Authentication and user accounts
- Session, shot, and scoring persistence
- Media upload and storage for captured video/images
- Serving or invoking [`ml/`](../ml/) inference

## Layout

Runtime and deployment target are not yet chosen. Record the decision in
[`docs/`](../docs/), then replace this note with setup and deploy instructions.

Never commit secrets. Configuration comes from environment variables; document
required variables here and keep a `.env.example` alongside the code.
