# Tapio by MationX

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
2. Describe a concrete capability, including optional test context (a contact, community, destination or other input).
3. Leave **Fast demo** enabled for WhatsApp and Reddit: prepared profiles navigate real screens and immediately expose MCP tools. Preview tests fill real drafts; sending/publishing still requires explicit authorization. Disable this option for experimental general AI exploration. Click **Scan & build MCP**. Each run starts the app through its MAIN/LAUNCHER activity with a cleared task, observes the real UI, then asks Codex for one constrained action. An app can still restore its own saved navigation; the planner must inspect the starting screen.
4. Review learned screens and generated MCP tools.
5. Review the proposed test parameters and expected outcome. **Check draft** verifies the inputs. **Run test & verify** shows the exact capability and parameters for confirmation, runs the test and checks the workflow’s observable completion conditions. It does not claim delivery.
6. Prepared demo profiles and tools that passed a real test appear in MCP discovery. **Connect MCP** displays the endpoint and bearer-token configuration for a client running on this Mac. Refresh the client's tool list after mapping.

## Architecture

- `src/phone.mjs`: explicit per-device ADB bridge, screenshots, semantic UI nodes and fresh launcher tasks.
- `src/app-labels.mjs`: extracts only APK manifest and resources to read actual labels with Android's aapt2. It does not copy whole application APKs.
- `src/planner.mjs`: uses official `codex exec` with the existing ChatGPT login, a compact list of meaningful UI elements and a strict JSON output schema. Screenshots are only sent when the accessible UI has fewer than three meaningful elements. Custom editor text is read locally with macOS Vision OCR; the planner receives compact recognized text. It does not copy authentication tokens or scrape ChatGPT's browser UI.
- `src/server.mjs`: local web API, jobs, generated tool registry, and official MCP SDK Streamable HTTP transport.
- `src/workflow.mjs`: generic test proposals and deterministic preview/completion contracts.
- `src/ocr.mjs` and `src/ocr.swift`: local visual text fallback for custom editors; the helper is compiled into ignored `work/` with installed Apple developer tools.
- `src/policy.mjs`: mapping/preview stops before final submission; calls, purchases and deletion are rejected.

Generated tools are semantic goals grounded in observed screens; each execution uses fresh UI observations and generic result contracts. They are not fixed coordinate macros. Screens may contain private content: observations are sent to Codex when a run starts. Cached metadata, UI maps and planner inputs are in ignored `work/` and are not committed.

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

Workflow validation is app-independent. Each mapped capability defines variable parameters, an observed final action, preview checks and completion checks. External actions must produce a new visible result; a tap alone cannot verify success. `allow_external_action` authorizes the final action for the supplied parameters. Apps without accessible UI elements or an observable result can remain blocked and must not be labelled supported. Repeated actions on unchanged UI are stopped, and a send attempt is never automatically retried within a run.

## Product contract

The user selects an installed app by name and describes a capability in ordinary language. The same exploration engine must discover the workflow, variable inputs, final action and observable result across apps; WhatsApp and Reddit are examples, not special integrations. Mapping proposes a concrete test. The studio distinguishes mapped, prepared and verified capabilities and exposes prepared demo profiles alongside verified tools through MCP. Never silently reduce “send a message” or “publish a post” to a draft-only capability. Use the low-cost Luna planner by default; keep observations compact and expose direct fill/tap actions and focused-editor replacement.

Universal app coverage is a design requirement, not a validated guarantee. Apps with inaccessible editors, invisible result states, login requirements or unsupported text input require further capability work; failed tests must remain visible.

## Landing page

`landing/index.html` is the public Tapio landing page. `vercel.json` deploys only this static page; ADB, local state and the MCP server stay on the laptop. The demo links open localhost on the visitor’s computer.

## Fast WhatsApp execution

The MCP caller sets `allow_external_action: true` for an explicitly authorized send request; one call navigates, writes, submits and checks a new visible message bubble. An exact contact match is required, with accents/case normalized. A matching open chat is reused. Otherwise it opens WhatsApp and uses live semantic UI controls for search and exact contact selection. Search fields are focused and replaced before reading results. Contact selection, draft verification and the final result use live UI, never saved message coordinates. A fresh preview observation is reused immediately for the final action instead of dumping the same screen twice. No send attempt is automatically repeated.

## Prompt demo

The studio’s **Ask your agent** form accepts a request such as `Send a WhatsApp message to David Čečko: "Hello David, testing Tapio."`. Run invokes an actual MCP SDK client against the local server. Explicit send/post requests authorize final submission; explicit draft requests stop at preview. Common demo message syntax uses a fast interpreter; other requests use one Luna call to choose any available tool and bind parameters. This does not imply arbitrary apps are already supported.
