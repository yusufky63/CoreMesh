# Deploying CoreMesh

CoreMesh is built with vinext on Vite and served by Nitro. Locally that is a
Node server; on Vercel the Nitro preset is detected during the build and emits
the Vercel output. The browser holds identities; the server holds provider
keys behind the relay. This page is the go-live checklist.

## 1. Secrets

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

Locally the same names live in `.env` (git-ignored). On Vercel set them from a
file so the value never appears in shell history:

```bash
grep '^COREMESH_RELAY_TOKEN=' .env | cut -d= -f2- | vercel env add COREMESH_RELAY_TOKEN production
```

Repeat for `preview` and for each provider key.

## 2. Build and verify locally

```bash
npm run check
```

```bash
npm start
```

`npm start` serves the production bundle from `.output/` on port 3000
(override with `PORT`). Export the variables from `.env` into the shell first,
or run through a process manager that loads them. Verify the relay:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/providers/deepseek?path=models"
```

Expect `401`. With the token:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "x-coremesh-relay: $(cat .coremesh-worker/relay-token)" "http://localhost:3000/api/providers/deepseek?path=models"
```

Expect `200`. A cross-site probe must be refused:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.example" -H "x-coremesh-relay: $(cat .coremesh-worker/relay-token)" "http://localhost:3000/api/providers/deepseek?path=models"
```

Expect `403`.

## 3. Deploy to Vercel

The repository carries `vercel.json` (framework `null`, `npm run build`).
After linking the project once with `vercel link`, every push to `main`
deploys through the GitHub integration, or deploy from the CLI:

```bash
vercel deploy --prod
```

Run the same three relay probes against the production URL.

## 4. Operators

Each operator pastes the relay token into **Settings › Hosted relay** for the
session. It is never written to browser storage. Operators who prefer their own
provider key enter it as a session key in Providers and need no relay token.

## 5. Agents that keep working

The web app's workers stop with the tab. For continuous work run the local
daemon or the MCP server on a machine you control (see `HOW_IT_WORKS.md`):

```bash
npm run worker -- --config coremesh-worker.json
```

Secrets for those surfaces stay on that machine: the vault passphrase in
`COREMESH_VAULT_PASSPHRASE` or a file named by
`COREMESH_VAULT_PASSPHRASE_FILE`, and the provider key in the environment
variable the config names. They never use the hosted relay.

## 6. After go-live

- Rotate `COREMESH_RELAY_TOKEN` by setting a new value; sessions re-enter it.
- Watch the relay's `429` rate and raise `COREMESH_RELAY_RPM` only if real
  operators hit it.
- Technocore rooms retain seven days; nothing in CoreMesh is durable storage
  for protocol history. Export receipts and identity bundles you care about.
