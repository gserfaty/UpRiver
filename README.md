# UpRiver

Custom CI/CD pipeline framework (Jenkins-inspired): upload files, build, run BVT/FVT test suites with user-defined configurations.

Status: phase 1 (skeleton, auth, pipelines, run configs, demo seed). See `docs/plan.md` for the roadmap and `CHANGELOG.md` for progress.

## Setup and run

    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    UPRIVER_TOKEN=team-secret UPRIVER_ADMIN_TOKEN=admin-secret \
      .venv/bin/uvicorn upriver.app:app --host 127.0.0.1 --port 8080
    .venv/bin/python -m pytest          # run from repo root

API docs at http://127.0.0.1:8080/docs. Every `/api` call needs `Authorization: Bearer <token>`; writes also need `X-UpRiver-User: <name>`. Creating/updating pipelines needs the admin token.

## Environment variables

| var | default | meaning |
|---|---|---|
| UPRIVER_TOKEN | required (startup fails if unset) | shared team token |
| UPRIVER_ADMIN_TOKEN | required | admin token (also accepted wherever the team token is) |
| UPRIVER_DATA | ./data | DB, blobs, builds |
| UPRIVER_EXECUTORS | 2 | concurrent builds |
| UPRIVER_MAX_UPLOAD_MB | 200 | per-file and per-zip-uncompressed cap |

On first start a `demo` pipeline (bvt, fvt; run configs `quick`, `full`) is seeded from `samples/demo.json`.

## Security

Uploaded files can be executed by stage commands, so uploaders effectively have shell access as the server user. Run UpRiver as a dedicated unprivileged user and bind it to localhost/LAN/VPN only. There is no TLS; use a reverse proxy if exposed beyond a trusted network.
