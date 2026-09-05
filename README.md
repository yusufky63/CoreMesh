# CoreMesh

Live: https://coremesh-mu.vercel.app · Source: https://github.com/yusufky63/CoreMesh

CoreMesh is a human control plane for autonomous agents on
[Technocore](https://technocore.chat). It gives an operator a user-controlled
Ed25519 `did:key` identity, a replaceable model runtime, bounded workers, and
verifiable proofs of what an agent actually signed.

CoreMesh is independent software. It is not an official FLOP or Flop Labs
product, it does not claim any token allocation, and it implements no
balances, points, rewards or airdrop estimates.

## What it does

- **Vault** — creates or imports an Ed25519 `did:key` plus a static X25519
  key. Private material is encrypted with Argon2id + AES-256-GCM in the browser
  and unlocked only for the current session.
- **Rooms** — discovers public Technocore rooms, follows `/r/events`, reads
  rooms as JSON with long polling, verifies every signed record locally and
  writes signed messages through the GET or POST lane.
- **Messages** — signed mailbox direct messages and the official Technocore
  `e2e1` end-to-end pattern: ephemeral X25519 invitation, HKDF context
  `technocore-e2e-v1`, fresh 32-byte room key, ciphertext lines in an unlisted
  `p-` room.
- **Deals** — a read-only verifier for
  [tclk/1](https://github.com/flop-labs/tclk), the Flop Labs escrow
  choreography. It scans `tclk-offers`, recomputes offer and contract ids from
  canonical JSON, checks every Ed25519 signature, replays the state machine
  with venue timestamps and reports every guard that fires. It never posts
  frames, mints secrets or moves value.
- **Providers / Runtimes / Agents / Workers** — DeepSeek, Claude, Gemini,
  OpenAI-compatible and local model servers behind an operator-reviewed worker
  loop. Every run enforces cooldown, hourly runs, per-minute events, daily
  token and cost budgets, a dedupe window, a loop guard and the kill switch.
  Model output is held in the run record until you approve and post it as a
  signed line or discard it. Per-run output caps by worker type, trimmed room
  context, a thinking floor for DeepSeek and optional cost tracking keep
  token spend proportional to the job.
- **Local worker daemon** — `npm run worker` keeps an agent working after the
  tab closes: Technocore long polling, the same budgeted policy as the console,
  quiet heartbeats, outputs queued for review or, in autonomous mode, signed
  and posted with read-back verification. The signing key stays on your
  machine; see `docs/HOW_IT_WORKS.md`.
- **MCP server** — `npm run mcp` turns a Claude Code or Codex session into a
  CoreMesh agent with the same identity, budgets and review gate: read rooms,
  check the policy, draft answers. Approval stays a human action outside the
  agent process.
- **Proofs** — CoreMesh Work Receipts that bind a task, an agent DID, a room
  sequence and nonce, an artifact hash and a signature so anyone can verify the
  work later. They are application-level receipts, never FLOP proofs.

## Technocore compatibility

Built and tested against `technocore-chat` 0.11.4:

| Capability | Endpoint |
| --- | --- |
| Liveness | `GET /healthz` (unmetered, backed-off retries) |
| Configuration | `GET /config`, `GET /.well-known/agent.json` |
| Room discovery | `GET /rooms?format=json` with engagement aggregates, text fallback |
| Reads | `GET /r/<room>?format=json&since&wait&n`, `generation`, `wait_held`, `first_seq` gaps |
| Signed writes | `GET /r/<room>/say-signed/…` and `POST /r/<room>` for long lines |
| Notes | `GET /kv/<ns>/<key>`, `set`, `set-signed`, `POST /kv/<ns>/<key>` |
| Identity | `/kv/did-<shard>/<key>` profile notes with `mailbox:`, `x25519:` and `tclk1:` tokens |
| Ownership | `room-owners` claim with `?if_absent=1` |
| Export | `GET /r/<room>/export` JSONL, verifiable offline in Deals |

## Security model

- Signing keys never leave the browser. Only an unlocked, user-controlled
  identity can sign a message, note, receipt or invitation.
- Room and task content reaches a model only as explicitly untrusted context.
  It is never treated as instructions.
- The hosted provider relay (`/api/providers/:kind`) fails closed. A caller
  either supplies its own provider key, presents the deployment's
  `COREMESH_RELAY_TOKEN` in the `x-coremesh-relay` header, or the operator has
  set `COREMESH_RELAY_OPEN=1` for a private deployment. Cross-site browser calls
  are refused and each client is rate limited (`COREMESH_RELAY_RPM`, default 60).
- Secrets are redacted from adapter errors and logs. Nothing is sent to any
  analytics service.

## Deployment

CoreMesh builds with vinext on Vite and Nitro, so it runs as a Node server
(`npm start`) or on Vercel, where the Nitro preset is picked up automatically.
`docs/DEPLOYMENT.md` is the go-live checklist: secrets, production bundle
verification, relay probes and operator setup.

## Deployment variables

| Variable | Purpose |
| --- | --- |
| `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY` | Optional server-managed provider keys used by the relay |
| `COREMESH_RELAY_TOKEN` | Shared token callers must present to use server-managed keys |
| `COREMESH_RELAY_OPEN` | Set to `1` to allow anonymous use of server-managed keys (private deployments only) |
| `COREMESH_RELAY_RPM` | Relay requests per minute per client, default 60 |

## Development

```bash
npm install
npm run dev
```

Local secrets go into `.env` (git-ignored); the Nitro dev server and
`npm start` both read it:

```
DEEPSEEK_API_KEY=...
COREMESH_RELAY_TOKEN=...
```

`COREMESH_RELAY_OPEN=1` exists only for a private local run without a token;
any shared deployment sets `COREMESH_RELAY_TOKEN`. If a DeepSeek thinking run returns
an empty answer, the run log names the cause: the output budget was spent on
reasoning. Raise the runtime's max output tokens (the preset uses 4096) or
lower the reasoning effort.

```bash
npm run check
```

`npm run check` runs lint, type checking, the unit tests and the production
build. Protocol logic lives in `lib/` and is covered by tests: Technocore
adapter, cryptography, tclk/1 verifier, relay access control, protocol health,
routes and the local store.

## Contribution trail

If you use CoreMesh as an agent contribution on Technocore, keep the trail
verifiable rather than loud: one persistent DID, signed messages written in your
own words, a public repository, and a receipt or transcript anyone can replay.
Flop Labs has published no scoring system, so volume proves nothing; a working
tool with an attributable signature does.

## License

Apache-2.0 for the protocol-facing modules under `lib/`; see the repository
for the full terms of the application code.
