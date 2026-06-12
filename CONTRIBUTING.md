# Contributing to Get It.

> Read it. See it. Get it. Now help build it.

Get It. is open source because the best study tool should be built in the open, by the people who actually use it. We are a small team of students who shipped this in 24 hours and kept going. There is a lot still to build, and we would love your help.

This guide explains where we are headed, who we are looking for, and how to get involved.

## The vision

Most study tools measure surface area. Flashcard ratings measure recall in the moment. Mind maps measure how much you drew. Summaries measure how patient the AI was. None of them answer the only question that matters on exam day: *would I survive a question I have not seen before?*

Get It. is the layer that answers it. It is built around the document instead of in place of it, it turns a PDF into a measurable mastery map, and it runs on the ChatGPT account the student already pays for, with no second subscription and no Get It. server in the middle. Your data stays on your machine.

Everything we build should push on that core idea: help a student understand a concept faster, then prove to themselves that they actually got it. If a feature does not serve that, it probably does not belong here.

Where we want to go next, in no particular order:

- More and better visualization renderers, and renderers that fail less and self-repair more.
- Sharper agents and prompts, especially the evaluator that scores mastery.
- Support for more document shapes and longer documents without breaking a single ChatGPT plan.
- A smoother first run on every operating system, architecture, and dependency setup.
- Accessibility, localisation, and performance across low-end machines.

## Who we are looking for

Anyone who wants to make Get It. better. Really.

- **Maintainers** who can own an area, review pull requests, and help steer the roadmap.
- **Contributors** who want to fix a bug, add a renderer, tighten a prompt, or improve the desktop packaging.
- **Designers** who can make the product clearer and calmer.
- **Testers** who run it on hardware and operating systems we do not have, and tell us what broke.
- **Smart people with sharp ideas**, even if you do not write code. Open an issue, start a discussion, tell us what you would build.

You do not need permission to start. Pick something, dig in, and ask when you get stuck.

## Join the community

We organise the work on Discord. That is where we plan features, review work in progress, divide up tasks, and help each other ship. If you want to contribute, this is the fastest way to find something to do and to get unblocked.

**[Join the Get It. Discord](https://discord.gg/DpQPswRhsK)**

Come say hi, tell us what you are interested in, and we will point you at something that fits.

## Ways to contribute

- **Code.** Visualization renderers, study tools, the knowledge-graph pipeline, the Electron shell, the in-app updater, the setup wizard.
- **Agents and prompts.** Nine prompts sit behind two interchangeable auth paths (OpenAI Codex or Anthropic Claude). Better detection, better visualizations, fairer evaluation.
- **Cross-platform testing.** macOS (Apple Silicon and Intel), Windows 10 and 11, Linux. Different ChatGPT tiers, different document types.
- **Docs.** This guide, the README, the technical writeup, and in-app copy.
- **Triage.** Reproduce issues, label them, and help others land their first pull request.

## Getting started

The full developer setup lives in the README under [Hack on it](README.md#hack-on-it). The short version:

```bash
git clone https://github.com/beltromatti/get-it.git
cd get-it
npm install
npm run dev    # builds the Next.js standalone bundle and opens it in Electron
```

For browser-side hot reload, use `npm run browser:dev` and open `http://localhost:3000`.

To understand how the pieces fit together before you change them, read [`technical-writeup.md`](technical-writeup.md). It covers the agent design, the four-axis mastery rubric, the per-document evaluator queue, the LLM-code sandbox, and the desktop-packaging layer.

A quick map of the codebase:

| Area | Where |
|---|---|
| Agents, prompts, schemas, Codex wrapper | `lib/` |
| HTTP routes (one per tool and job) | `app/api/` |
| Right-pane tools and the visualizer | `components/` |
| Desktop shell, setup wizard, auto-update | `electron/` |
| Build and release scripts | `scripts/` |

## Opening a pull request

1. Branch off `main`.
2. Keep the change focused. One idea per pull request is easier to review and land.
3. Match the surrounding code: its naming, comment density, and style. Read the relevant file before you edit it.
4. Make sure it builds and type-checks before you push:

   ```bash
   npm run build            # next build runs the TypeScript check
   npm run lint
   npm run test:errors      # fast unit checks for the Codex error model
   ```

5. Write a clear description: what changed, why, and how you tested it. Screenshots help for anything visual.
6. If the change is large or you are unsure about direction, talk it through on Discord first so your time goes where it counts.

We aim to be quick and kind in review. If something is not merged right away, it is about the change, never about you.

## Be good to each other

Be welcoming, be patient, assume good faith, and help newcomers. Harassment and unkindness are not welcome here. If something feels off, message a maintainer on Discord or email [beltromatti@gmail.com](mailto:beltromatti@gmail.com).

## License

By contributing, you agree that your contributions are licensed under the project's [Apache License 2.0](LICENSE), the same license that covers Get It. itself.

Thank you for helping build something students can actually rely on.
