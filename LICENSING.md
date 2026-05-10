# Licensing

This repo is **MIT-licensed by default** (see [`LICENSE`](LICENSE)).

The only exception is the protocol JSON Schemas under `packages/protocol`,
which are **Apache-2.0** (see [`packages/protocol/LICENSE`](packages/protocol/LICENSE)).

| Path | License |
|---|---|
| `packages/protocol/` | Apache-2.0 — same license as the JSON Schema toolchain it lives next to |
| `packages/agent-sdk/` | MIT — embed in any agent, fork, ship |
| `examples/*` | MIT — fork as starter templates |
| Everything else (root configs, build scripts, docs) | MIT |

The Apache-2.0 carve-out for `packages/protocol` is intentional. Everything
else is MIT so you can drop it into any codebase without attribution drama.
