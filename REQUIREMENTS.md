# Requirements — Index

This repo hosts two backend services:

- [`node-api/REQUIREMENTS.md`](node-api/REQUIREMENTS.md) — Node.js 24+, MongoDB, `npm install`
- [`ai-service/README.md`](ai-service/README.md) — Python 3.12, `pip install -r requirements-dev.txt`

node-api remains the sole source of truth and only entry point for every route the frontend calls;
ai-service is a narrow internal AI microservice node-api proxies to, never called directly by the
frontend. See `README.md` for details, including why this is not the same as the legacy
`python-service/` (a full duplicate backend) that was removed in an earlier pass.

Frontend requirements live in the frontend's own repo: `D:\Upscaler-Frontend\REQUIREMENTS.md`.
