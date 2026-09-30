# App to MCP

Local hackathon prototype: describe an Android capability, let a ChatGPT-backed planner explore the app over USB ADB, then call the generated MCP tools.

## Start

```sh
npm ci
codex login
npm start
```

Open http://127.0.0.1:4318. This Mac already has an authenticated Codex CLI, ADB and Android SDK build-tools. USB debugging must be authorized on the phone. `scrcpy` is useful for manual control but is not required by the server.

Environment options:

- `ANDROID_SERIAL`: target from `adb devices -l` (current default is the connected demo phone).
- `ADB`: path to ADB (current default is `/Users/Petr/Tools/platform-tools/adb`).
- `CODEX_BIN`: path to the authenticated Codex CLI; defaults to `codex` on PATH.
- `AGENT_MODEL`: optional Codex model override; defaults to `gpt-6-luna` with low reasoning.
- `AAPT2`: optional path to Android SDK aapt2; newest installed stable macOS build-tools is detected by default.
- `PORT`: defaults to 4318.
- `MCP_TOKEN`: optional fixed bearer token. Without it, each server start generates a fresh token.

## Demo flow

1. Select an app by its actual application label. Only user-installed packages with launcher activities are eligible. Names load in the background and are cached locally.
2. Describe a concrete capability, including a test contact if mapping a messaging workflow.
3. Click **Explore & build tools**. Each run starts the app through its MAIN/LAUNCHER activity with a cleared task, observes the real UI, then asks Codex for one constrained action. An app can still restore its own saved navigation; the planner must inspect the starting screen.
4. Review learned screens and generated MCP tools.
5. Fill tool parameters and use **Run preview** to prepare the workflow. **Run & allow sending** explicitly authorizes message sending for that run.
6. **Connect MCP** displays the endpoint and bearer-token configuration for a client running on this Mac. Refresh the client's tool list after mapping.

## Architecture

- `src/phone.mjs`: explicit per-device ADB bridge, screenshots, semantic UI nodes and fresh launcher tasks.
- `src/app-labels.mjs`: extracts only APK manifest and resources to read actual labels with Android's aapt2. It does not copy whole application APKs.
- `src/planner.mjs`: uses official `codex exec` with the existing ChatGPT login, a compact list of meaningful UI elements and a strict JSON output schema. Screenshots are not sent on routine exploration steps. It does not copy authentication tokens or scrape ChatGPT's browser UI.
- `src/server.mjs`: local web API, jobs, generated tool registry, and official MCP SDK Streamable HTTP transport.
- `src/policy.mjs`: mapping/preview stops before sending; calls, purchases and deletion are rejected.

Generated tools are semantic goals grounded in observed screens; each execution uses fresh UI observations. They are not fixed coordinate macros. Screens may contain private content: observations are sent to Codex when a run starts. Cached metadata, UI maps and planner inputs are in ignored `work/` and are not committed.

## Validation

```sh
npm run check
npm test
node test/planner-smoke.mjs
node test/integration.mjs
```

The planner smoke test uses synthetic data. The integration test reads the real phone without tapping or sending. It checks authentication, origin/token protections and an MCP SDK client handshake and observation call.

## Current limits

- ASCII typing only through Android `input text`; use scrcpy for accented text. Literal `%s` is rejected because Android translates it into a space.
- Exploration is capped at 12 steps; execution at 24. Each step is a separate Codex invocation, so latency is noticeable.
- The constrained executor has heuristic side-effect checks; this is a supervised hackathon prototype, not a hardened production agent for arbitrary apps.
- The server listens only on loopback. Remote ChatGPT cannot connect to this local URL without a separately authorized hosting/tunnel setup.
- Message sending must be explicitly authorized for each execution.
