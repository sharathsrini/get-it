<div align="center">

# Get It.

### Read it. See it. Get it.

**The study companion that turns a PDF into a measurable mastery map. Built around the document, not in place of it.**

[![GDG AI Hack 2026](https://img.shields.io/badge/GDG%20AI%20Hack-Milan%202026-1a1a2e?style=for-the-badge)](https://gdg.community.dev/)
[![Website](https://img.shields.io/badge/Website-getit.noesisai.it-5b66f1?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIi8+PGxpbmUgeDE9IjIiIHkxPSIxMiIgeDI9IjIyIiB5Mj0iMTIiLz48cGF0aCBkPSJNMTIgMmExNS4zIDE1LjMgMCAwIDEgNCAxMCAxNS4zIDE1LjMgMCAwIDEtNCAxMCAxNS4zIDE1LjMgMCAwIDEtNC0xMCAxNS4zIDE1LjMgMCAwIDEgNC0xMHoiLz48L3N2Zz4=&logoColor=white)](https://getit.noesisai.it)
[![Built with Codex CLI](https://img.shields.io/badge/Built%20with-Codex%20CLI-111113?style=for-the-badge&logo=openai&logoColor=white)](https://github.com/openai/codex)

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![Electron](https://img.shields.io/badge/Electron-33-2C2C2C?logo=electron&logoColor=9FEAF9)](https://www.electronjs.org/)
[![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind-4.x-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Three.js](https://img.shields.io/badge/Three.js-r184-000000?logo=threedotjs&logoColor=white)](https://threejs.org)
[![pdf.js](https://img.shields.io/badge/pdf.js-5.x-F40F02?logo=mozilla&logoColor=white)](https://mozilla.github.io/pdf.js/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](#license)

<br />

![Get It. hero animation](hero.gif)

</div>

---

## The problem

The student already has the PDF. They don't need another summary. They need to see the parts a textbook refuses to draw, and they need a way to prove to themselves that they have understood. Concept by concept, not page by page.

Today's tools measure surface area, not depth. Flashcard ratings measure recall in the moment. Mind maps measure how much you drew. Summaries measure how patient the AI was. None of them answer the only question that matters on exam day:

> *Would I survive a question I have not seen before?*

Get It. is the layer that answers it.

## How it works

Drop a PDF — a digital, text-based one. Get It. checks the file up front and turns away scans or image-only documents with a clear message, because it reads text, not pictures. Once a file clears that gate, three things start at once.

1. **The page tags itself.** A concept-detection agent walks every page and plants inline tag pills on the words that benefit from a picture. Each tag carries a renderer choice: 3D scene, 2D animation, formula walkthrough, plotted graph, or cited source.
2. **The right pane fills in.** Click a tag and its visualization renders — Three.js for anatomy and molecules, Canvas for physics and chemistry animations, KaTeX-clean formulas, a plot engine for functions and distributions, authoritative quotes for legal articles and named papers. Ready tags are marked so you can tell what already exists, and a setting renders every tag automatically as you read if you prefer. When a sandbox crashes, the agent reads its own error and re-emits a fix. The student sees "repairing" instead of red text.
3. **A knowledge graph builds itself.** Six to twenty-five concept nodes, typed edges, sized by mastery, coloured by progress, clickable for the four-axis breakdown plus the evaluator's note.

Then the loop closes. Four study tools feed one journal.

| Tool | What it measures |
|---|---|
| 💬 **Chat** | Recall references and paraphrases. Multi-turn, multi-thread, scoped to one document. |
| 🎴 **Flashcards** | Open-recall under self-grade. Again / Hard / Good / Easy on every card. |
| ✅ **Quizzes** | Forced-choice discrimination. One correct answer, three plausible distractors. |
| 💡 **Feynman** | The agent plays a curious eight-year-old. *You* teach. The strongest comprehension signal. |

After every completed session the **evaluator** agent reads the journal end-to-end and updates four scores per concept node on the knowledge graph: **memory, comprehension, structure, application**. Each scored 0 to 100. Each monotone non-decreasing by a runtime clamp. The student can only progress, never regress.

The four numbers are the difference between a study app and a measurement instrument.

## Bring your own ChatGPT (or Claude)

The AI side of Get It. has no business model layered on top.

You sign in once with a subscription you already pay for — either **OpenAI** (ChatGPT account or an OpenAI API key, through the official Codex CLI) or **Anthropic** (a Claude Pro/Max account, through the official Claude Code CLI's browser login). Every agent inside the app runs against your own tier. There is no Get It. server, no shared key pool, no per-message metering, no "AI credits" wallet, no second subscription, and no plan to ever ship one.

- **You pay for AI once.** On OpenAI, ChatGPT Plus, Pro, Team, Enterprise, or Edu covers everything Get It. does. On Anthropic, a Claude **Pro** or **Max** subscription does the same — the Claude Code browser login uses your subscription, not separate per-token API billing.
- **Pick your engine.** Choose OpenAI Codex or Anthropic Claude in the first-launch wizard (and switch later from in-app settings). The two are interchangeable auth paths behind the same nine study agents.
- **Plus / Pro is the practical floor.** OpenAI's free tier signs in but its Codex allowance is intentionally small; Plus and above give comfortable session headroom. On Anthropic, a Claude Pro or Max plan is required for the subscription login.
- **Your data stays yours.** Your documents and study journal never leave your computer: no accounts, no cloud sync, no document upload, no model traffic through our servers. The only thing the app sends is an anonymous open/update ping — a random install id, the app version, and your OS, nothing else — so we can count how many people Get It. is helping; set `GETIT_DISABLE_ANALYTICS=1` to turn even that off. The work-context journal is a single JSON file on your disk, downloadable in one click from the right-pane menu.
- **Rate limits are the provider's.** When you hit one (OpenAI's or Anthropic's), the app shows a countdown banner, stops cleanly, and your work is saved. Nothing retries in a loop: once the window clears you pick back up with a click (re-click a concept, hit Retry on a tool).

Other AI study apps wrap a marked-up subscription around a model API the vendor holds. Get It. wraps a study workflow around the access you already have.

## Install

Get It. is a desktop app. Download the installer for your machine, double-click, then pick your AI engine and sign in with the OpenAI or Anthropic account you already use. Nothing else to buy.

| Platform | Installer |
|---|---|
| macOS (Apple Silicon, M1 / M2 / M3 / M4) | `Get It-<version>-arm64.dmg` |
| macOS (Intel) | `Get It-<version>.dmg` |
| Windows 10 / 11 (x64) | `Get It Setup <version>.exe` |
| Linux (x64) | `Get It-<version>.AppImage` |

Every release ships on the **[Releases](https://github.com/beltromatti/get-it/releases)** page. The app checks for a newer build on every launch and offers a one-click update inside its own window.

### First launch

The setup wizard lets you choose **OpenAI Codex** or **Anthropic Claude**, verifies the matching bundled CLI, walks the browser OAuth sign-in, and refuses to open the main window until both gates (CLI present, signed in) are green. Then drop a PDF, or open one of the five bundled samples (anatomy, classical mechanics, Italian constitution, calculus, organic chemistry). Tags, chats, flashcard decks, quizzes, Feynman sessions, and the knowledge graph all stay on your computer.

### Gatekeeper and SmartScreen

macOS builds (both Apple Silicon and Intel) are **signed with a paid Apple Developer ID Application certificate AND notarized by Apple**. On a fresh download from this repo's [Releases](https://github.com/beltromatti/get-it/releases) page the OS opens the app with **no Gatekeeper prompt** — the stapled notarization ticket tells Gatekeeper the binary is trusted before the network is even consulted. `spctl --assess` reports `source=Notarized Developer ID` and `xcrun stapler validate` passes on both architectures.

Windows builds are not signed. The first launch shows a SmartScreen warning ("Windows protected your PC"); click **More info → Run anyway**. The warning persists because SmartScreen reputation is per-certificate and we currently don't ship a Windows code-signing cert (Microsoft's Trusted Signing service requires a paid Azure subscription that the project doesn't carry).

If you ever pull a build that *wasn't* notarized — a local ad-hoc build before secrets are wired up, an old release from before v1.2.1 — macOS shows the "unidentified developer" prompt instead. The bypass is **System Settings → Privacy & Security → Open Anyway** (macOS Sequoia 15 and macOS 26 removed the older right-click → Open shortcut). Or strip the quarantine flag in one shot from the CLI: `xattr -dr com.apple.quarantine "/Applications/Get It.app"`.

### Storage

Everything lives under one OS-native directory.

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/get-it/` |
| Windows | `%APPDATA%\get-it\` |
| Linux | `~/.local/share/get-it/` |

Layout: one folder per document at `docs/<docId>/` (source PDF, extracted text cache, tags, work context, knowledge graph), a `docs.json` index at the root, a `codex-scratch/` working dir, and `logs/`. Deleting a doc from the Library wipes the whole folder.

## Hack on it

```bash
git clone https://github.com/beltromatti/get-it.git
cd get-it
npm install
npm run dev    # builds the Next.js standalone bundle and opens it in Electron
```

`npm run dev` exercises the full path: setup wizard, embedded server, IPC bridge. Re-run after edits.

For browser-side hot reload:

```bash
npm run browser:dev    # http://localhost:3000
```

(The Electron-internal HMR loop has a known Next 16.2.6 + Turbopack + Chromium 130 hydration glitch, so browser dev or rebuild-and-test is the cleaner inner loop.)

Local desktop builds, one or all targets:

```bash
npm run build && npm run electron:prepare

node scripts/build-electron.mjs --target=mac-arm64   # or mac-x64 / win-x64 / linux-x64 / --all
```

Artefacts land in `dist-electron/`. Cross-arch builds pull the matching Codex platform package from npm on the fly, so you do not need an Intel Mac or a Windows VM to build for them.

Releases are tag-driven. Push a `vX.Y.Z` tag to `main` and `.github/workflows/release.yml` builds every target on a native runner, attaches the `.dmg` / `.exe` / `.AppImage` to a GitHub Release, and pins the version into Info.plist and NSIS metadata from the tag itself.

### Help build it

Get It. is open source because the best study tool should be built in the open. We are actively looking for maintainers, contributors, designers, testers, and anyone with sharp ideas. Read **[`CONTRIBUTING.md`](CONTRIBUTING.md)** for the vision and how to get involved, then come find something to build in the **[Discord community](https://discord.gg/DpQPswRhsK)**, where we plan features, review work, and divide up tasks.

## Architecture in one breath

```
upload  ─► quality gate (model-free) ─► pdfjs-dist extracts text + glyph bboxes per page
         │
         ├──► visualizer pipeline
         │     ├─ batched concept-detection agent  →  DetectedConcept[] with anchor strings
         │     │   (≤5 pages per call, concurrency 3)   (each concept carries its page)
         │     └─ per-tag visualization-spec agent  →  3d / 2d-anim / formula / graph / 2d-text spec
         │        (lazy: on click by default)           (server-side syntax preflight + client-side
         │                                               runtime repair loop on sandbox crashes)
         │
         └──► knowledge-graph pipeline
               ├─ kg-build agent (one-shot)            →  6–25 concept nodes + typed edges + global note
               │  ◄── full document text                  (bounded by the 150-page upload cap)
               └─ kg-evaluate agent (incremental)      →  per-node {memory, comprehension, structure,
                  ◄── current graph (baseline scores)     application} 0–100, monotone non-decreasing
                  ◄── interactions since the last pass
```

Nine prompts behind two interchangeable auth paths (OpenAI Codex or Anthropic Claude), nine schemas behind one shared provider wrapper. The full design rationale, the four-axis rubric, the per-doc evaluator queue, the LLM-code sandbox, and the desktop-packaging layer are in [`technical-writeup.md`](technical-writeup.md), also rendered as [PDF](technical-writeup.pdf).

## The team

Built in 24 hours at **GDG AI Hack 2026, Milan**, for the **Braynr** challenge. The hackathon submission lived at commit `277ec43`. Everything past that commit is post-hackathon polish: desktop packaging, the persistent Library, the first-launch setup wizard, the quizzes tool, the in-app auto-update flow, the server-side jobs runner, and long-document support that keeps a 100-page PDF affordable on a single ChatGPT plan. The product is the same. Only the way it gets onto a student's laptop has changed.

- **[Mattia Beltrami](https://www.linkedin.com/in/mattia-beltrami/)**, Politecnico di Milano
- **[Matteo Impieri](https://www.linkedin.com/in/matteo-impieri-5b5874331/)**, Politecnico di Milano
- **[Filippo Difronzo](https://www.linkedin.com/in/filippo-difronzo-3a56701b1/)**, Politecnico di Milano
- **[Luca Feggi](https://www.linkedin.com/in/luca-feggi-a643133b5/)**, Università di Padova

## Notice

**Get It. is an independent project. It is not affiliated with, endorsed by, or sponsored by OpenAI or Anthropic.** The app uses the official open-source [Codex CLI](https://github.com/openai/codex) and [Claude Code CLI](https://github.com/anthropics/claude-code) as the transport between the local app and each vendor's models, signed in with the end user's own account (ChatGPT/OpenAI API, or a Claude Pro/Max subscription). "OpenAI", "ChatGPT", and "Codex" are trademarks of OpenAI; "Anthropic", "Claude", and "Claude Code" are trademarks of Anthropic. We use the names only to describe what Get It. interoperates with.

Your use of OpenAI's or Anthropic's models through Get It. is subject to that vendor's own terms — OpenAI's [Terms of Use](https://openai.com/policies/terms-of-use), [Usage Policies](https://openai.com/policies/usage-policies), and [Privacy Policy](https://openai.com/policies/privacy-policy), and the Codex CLI's [license and release notes](https://github.com/openai/codex); or Anthropic's [Consumer Terms](https://www.anthropic.com/legal/consumer-terms), [Usage Policy](https://www.anthropic.com/legal/aup), and [Privacy Policy](https://www.anthropic.com/legal/privacy), and the Claude Code CLI's own license. Those documents are authoritative for what each model service permits, how data is handled on the vendor's side, and what each subscription tier covers.

## License

Apache License 2.0. See [`LICENSE`](LICENSE). Source is open. Contributions are welcome: see [`CONTRIBUTING.md`](CONTRIBUTING.md) and join us on [Discord](https://discord.gg/DpQPswRhsK).
