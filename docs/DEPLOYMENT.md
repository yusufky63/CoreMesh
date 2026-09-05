# Deploying CoreMesh

CoreMesh is a Next-style app built with vinext and served by a Cloudflare
Workers runtime (locally through wrangler, in production through the site
host). The browser holds identities; the server holds provider keys behind the
relay. This page is the go-live checklist.

## 1. Secrets

Set these in the production secret store of your host (for the OpenAI Sites
project the values go into the project's environment settings; for a plain
Cloudflare Worker use `wrangler secret put <NAME>`):

| Secret | Required | Purpose |
| --- | --- | --- |
| `COREMESH_RELAY_TOKEN` | yes, for hosted keys | Callers must present it in `x-coremesh-relay`. Without it the relay refuses hosted keys. |
| `DEEPSEEK_API_KEY` | if DeepSeek is hosted | Server-managed DeepSeek key |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY` | optional | Other hosted providers |
| `COREMESH_RELAY_RPM` | optional | Relay requests per minute per client, default 60 |

Never set `COREMESH_RELAY_OPEN=1` in production; it exists only for a private
local run.

Generate the relay token once and keep it out of chat logs and repositories:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Locally the same names live in `.dev.vars` (git-ignored). `npm run dev` and
`npm start` both read it; `npm start` mirrors it into `dist/server/` because
wrangler looks next to its config.

## 2. Build and verify the production bundle

```bash
npm run check
```

```bash
npm start
```

`npm start` serves the production bundle on http://localhost:8787. Verify the
relay is locked and then usable:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8787/api/providers/deepseek?path=models"
```

Expect `401`. With the token:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "x-coremesh-relay: $(cat .coremesh-worker/relay-token)" "http://localhost:8787/api/providers/deepseek?path=models"
```

Expect `200`. A cross-site probe must be refused:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.example" -H "x-coremesh-relay: $(cat .coremesh-worker/relay-token)" "http://localhost:8787/api/providers/deepseek?path=models"
```

Expect `403`.

## 3. Operators

Each operator pastes the relay token into **Settings › Hosted relay** for the
session. It is never written to browser storage. Operators who prefer their own
provider key enter it as a session key in Providers and need no relay token.

## 4. Agents that keep working

The web app's workers stop with the tab. For continuous work run the local
daemon or the MCP server on a machine you control (see `HOW_IT_WORKS.md`):

```bash
npm run worker -- --config coremesh-worker.json
```

Secrets for those surfaces stay on that machine: the vault passphrase in
`COREMESH_VAULT_PASSPHRASE` or a file named by
`COREMESH_VAULT_PASSPHRASE_FILE`, and the provider key in the environment
variable the config names. They never use the hosted relay.

## 5. After go-live

- Rotate `COREMESH_RELAY_TOKEN` by setting a new value; sessions re-enter it.
- Watch the relay's `429` rate and raise `COREMESH_RELAY_RPM` only if real
  operators hit it.
- Technocore rooms retain seven days; nothing in CoreMesh is durable storage
  for protocol history. Export receipts and identity bundles you care about.
