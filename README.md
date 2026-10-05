# LINE Sticker Generator

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A desktop application built with **Kiro** that turns natural-language descriptions into original LINE stickers.

Plan sets of **8, 16, 24, 32, or 40 stickers**, customize each sticker's message, expression, pose, and props, generate images with AI, and export a LINE-ready ZIP.

Built for the **Kiro University Challenge 2026**. The application UI is in Japanese.

## Demo video

**[Watch the demo on YouTube](https://youtu.be/l6AD7EtOL0A)**

The demo covers character descriptions, sticker planning, image generation, individual revisions, image conversion, and export.

## Features

- Natural-language descriptions of characters and art styles.
- Selection from 40 sticker templates for the selected theme.
- Customizable messages, expressions, poses, props, additional instructions, and optional image text.
- Batch generation or first-image approval before generating the rest.
- Individual regeneration with revised instructions.
- Enlarged image review and background switching for transparency checks.
- Generation preset saving and loading.
- Conversion and validation of LINE sticker assets.
- Independent selection of main and talk-room tab images.
- ZIP export of images and metadata.
- API credential storage in the OS keychain.

**OpenAI is the implemented image-generation provider.** Stable Diffusion and Midjourney adapter placeholders exist, but their API integrations are not implemented.

## Setup

### Requirements

- Node.js and npm.
- Python 3.11 or later.
- An OpenAI API key with access to the selected image model.
- A working OS keychain/credential service.

The application runs locally, but image generation uses an external API and incurs the provider's usage charges.

### Windows

Run these commands in PowerShell:

```powershell
git clone https://github.com/edoburg/kiro_uc.git
cd kiro_uc

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci

npm run dev
```

Electron starts the Python backend automatically, preferring the project's `.venv`.

For macOS/Linux, use `python3 -m venv .venv` and `.venv/bin/python -m pip install -r requirements.txt`, followed by `npm ci` and `npm run dev`. The documented build verification focuses on Windows.

### First launch

1. Select **OpenAI** as the AI engine.
2. Enter your API key.
3. Choose an output directory and complete setup.
4. In settings, select the image model and quality available to your account.

## Basic usage

1. **Describe the character and style.** Enter the common prompt in **共通設定（キャラクターの外見・画風）**.
2. **Select a theme, sticker count, and generation mode.** Choose batch generation (**一括生成モード**) or first-image approval (**プレビュー承認モード**).
3. **Choose templates and customize the items.** Edit each sticker's meaning, expression, pose, props, additional instructions, and optional text.
4. **Start generation.** In approval mode, review and approve the first image before generating the rest.
5. **Review and refine.** Use **大きく表示** to inspect images. Switch preview backgrounds to check transparency. Revise instructions and regenerate individual images as needed.
6. **Convert the completed images** to LINE asset sizes and check the validation results.
7. **Enter a set title and select the main and tab images.**
8. **Export the ZIP** using **エクスポート（ZIP保存）**.

Extract the ZIP and register the assets manually in LINE Creators Market.

Use **生成設定の保存と読み込み** to save and reload generation presets. Presets save generation settings rather than generated images. Loading a preset does not automatically start generation.

### Exported assets

| Asset | Output |
| --- | --- |
| Sticker images | PNG, within 370 × 320 px, at most 1 MB each |
| Main image | PNG, 240 × 240 px |
| Talk-room tab image | PNG, 96 × 74 px |
| Set information | `metadata.json` |
| Package | ZIP containing images and metadata |

Preview backgrounds are visual aids only. They do not remove backgrounds or modify exported pixels. Check transparency, text readability, and image quality before registering the stickers.

## Kiro University Challenge: lesson coverage

| # | Lesson | Application in this project | Evidence |
| --- | --- | --- | --- |
| 1 | Spec-driven development | User stories and EARS acceptance criteria, architecture and correctness properties, and implementation/testing tasks linked to requirements. | [Requirements](.kiro/specs/line-stamp-generator/requirements.md), [design](.kiro/specs/line-stamp-generator/design.md), [tasks](.kiro/specs/line-stamp-generator/tasks.md), [follow-up tasks](TASKS.md) |
| 2 | Steering documents | Product goals, Japanese UI requirements, technology choices, directory responsibilities, IPC boundaries, and credential-handling rules. | [Product](.kiro/steering/product.md), [technology](.kiro/steering/tech.md), [structure](.kiro/steering/structure.md) |
| 3 | Hooks | Session-start guidance, checks after agent file changes, tests after Spec task completion, and credential checks before writes. Triggering was verified in Kiro IDE on Windows. | [Hooks](.kiro/hooks/), [verification record](docs/kiro-hooks-verification.md) |
| 4 | Property-based testing | fast-check and Hypothesis verify prompt limits, history bounds, image output sizes, and configuration round trips with generated inputs. | [Prompt tests](src/__tests__/validation.promptLength.property.test.ts), [history tests](src/__tests__/promptHistory.property.test.ts), [image-size tests](tests/services/test_image_processor_size.py), [configuration tests](tests/services/test_config_service_roundtrip.py) |
| 5 | Powers | Context7 provided library/API documentation. A custom LINE Creators Market Upload Power supplied official references, checklists, and selector history for investigating requirements and upload-related code. | [Custom Power repository](https://github.com/edoburg/kiro-power-line-creators-market), including `POWER.md` and `steering/` |
| 6 | Model Context Protocol (MCP) | Playwright and Git MCP servers are configured for browser operations and repository inspection. Context7 supplies documentation through MCP. | [MCP configuration](.kiro/settings/mcp.json); Context7 uses the user-level Power configuration |
| 7 | Custom agents | Role-specific agents define scope, tools, conventions, and permissions for specification/design, frontend, backend, and read-only test verification. | [Spec planner](.kiro/agents/spec-planner.md), [frontend](.kiro/agents/frontend-dev.md), [backend](.kiro/agents/backend-dev.md), [test runner](.kiro/agents/test-runner.md) |

### Powers and submission scope

Powers were installed in the developer's user-level `~/.kiro/powers/` directory rather than this project's `.kiro/` directory.

- [Context7](https://github.com/upstash/context7)
- [LINE Creators Market Upload Power](https://github.com/edoburg/kiro-power-line-creators-market)

The custom Power is a documentation-based package. It does not contain an upload program or its own MCP server.

**Neither bonus lesson is included in this submission:**

- Kiro Web, cloud sessions, and cloud configuration.
- Package a Kiro power.

The custom Power is referenced as evidence for required Lesson 5.

## Development and verification

```powershell
# TypeScript tests and type checking
npm run test:run
npx tsc --noEmit

# Source linting, excluding generated backend bundles
npm run lint -- --ignore-pattern 'dist-backend/**' --ignore-pattern 'build-backend/**'

# Python tests
.\.venv\Scripts\python.exe -m pytest

# Hook verification
node .kiro/hooks/scripts/verify-hooks.cjs
```

On macOS/Linux, use `.venv/bin/python -m pytest`.

Property tests use at least 100 generated cases and reference the relevant requirements and properties. External services are mocked in the relevant automated tests.

Verification notes:

- [Hooks](docs/kiro-hooks-verification.md)
- [Transparency and enlarged review](docs/image-review-verification.md)
- [Generation presets](docs/generation-presets-verification.md)
- [Sticker text](docs/stamp-text-verification.md)
- [LINE upload investigation](docs/line-creators-market-verification.md)

These records describe checks performed during development, rather than claiming verification of every platform and external service.

## Build an installer

For Windows:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-build.txt
npm run build
```

The build bundles the Python backend with PyInstaller and packages the Electron application.

See [installer build instructions](docs/installer-build.md) for details and smoke checks.

## Technology stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Electron |
| UI | React, TypeScript, Vite |
| Local backend | Python, FastAPI |
| Image processing | Pillow |
| Credentials | OS keychain via Python keyring |
| Tests | Vitest, fast-check, pytest, Hypothesis |

Communication follows:

`React renderer → window.api → Electron IPC → local FastAPI backend`

## Current limitations

- **Direct LINE Creators Market upload is on hold.** Its UI is disabled by [the feature flag](src/config/features.ts). Use ZIP export and manual registration.
- Stable Diffusion and Midjourney API integrations are not implemented.
- Transparency, AI-generated text, and character consistency require visual review.
- Generation presets do not save generated images or representative-image selections.
- Windows build checks are documented; macOS/Linux builds and full clean-machine installation verification are not claimed.

## License

This project's source code is licensed under the **[MIT License](LICENSE)**, matching the existing `package.json` declaration.

Third-party dependencies and external services remain subject to their respective licenses and terms.

This is an independent project, not an official LINE product.