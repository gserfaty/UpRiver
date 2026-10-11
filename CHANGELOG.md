# Changelog

## Phase 1: skeleton, auth, pipelines, run configs
- FastAPI app with lifespan-read env config, SQLite schema (all tables), bearer-token auth (team/admin), `X-UpRiver-User` on writes.
- Pipeline CRUD (admin write) with pydantic config validation; run configs (upsert by name, validated against the pipeline).
- Demo pipeline seeded from `samples/demo.json`; `samples/bvt.sh`, `samples/fvt.sh`.
- Placeholder `static/index.html`; pytest suite and reusable `conftest.py` (client, headers, `wait_build`).
