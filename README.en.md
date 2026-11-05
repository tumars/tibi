<p align="center"><img src="docs/prototypes/img/logo.svg" width="72" alt="Tibi"></p>

<h1 align="center">Tibi</h1>

<p align="center">Read English articles you actually care about, and learn the language along the way.<br>A local-first, AI-native, open-source (MIT) reading app for Chinese-speaking learners of English.</p>

<p align="center"><a href="README.md">中文</a> · English · <a href="docs/guide/README.md">User guide (Chinese)</a> · <a href="https://github.com/tumars/tibi/releases">Download</a></p>

![Reader: new words are marked for your level; click one to see what it means in this sentence](docs/img/screenshots/reader.jpg)

> Tibi is built for people whose first language is Chinese: dictionary entries, AI explanations and the default interface are in Chinese. The interface can be switched to English in **Settings → General → Interface language**; to have Tibi explain in English, just tell it so in a chat.

## What it does

- **Import almost anything**: web pages, pasted text, EPUB books, PDF, Word, images and scanned PDFs (local OCR), plus a browser clipper extension.
- **You decide what's new**: no level test and no guessing. Only words you've marked as new or are learning get highlighted.
- **Click a word to understand it**: the word card shows its meaning *in this sentence* (AI-generated, cached), the ECDICT dictionary entry, phonetics and pronunciation.
- **A dictionary at hand**: works offline, understands inflected forms, Chinese lookups and misspellings; examples come from articles you've read.
- **AI reading help**: a one-click summary, key phrases, hard sentences and reading advice; a full translation; select a passage to ask Tibi; keep asking in chat.
- **Remember what you read**: new words go into spaced repetition (FSRS) using the sentences you actually read, plus dictation, spelling, confusable-word and sentence-writing practice.
- **See your progress**: known words, daily reading, review performance, a study calendar, and a short note from Tibi.
- **Read aloud**: system voices or a local neural voice (Kokoro), sentence-level highlighting, speed control, sentence loop.
- **Your data stays on your computer**: everything is stored in a local SQLite database; model API keys are kept in a separate local file, outside the database and Tibi's backups; export, back up and restore any time.
- **Works with other AI tools**: a built-in MCP server lets Claude Code, Codex and others read your progress and add words (writes need your approval).

## Install

Tibi is currently available for macOS only: download the `.dmg` for Apple silicon (`aarch64`) or Intel (`x64`) from [Releases](https://github.com/tumars/tibi/releases). iOS, Windows and Linux versions are coming. If GitHub is slow, use the mirror: [Apple silicon](https://dl.ferecord.com/latest/Tibi_aarch64.dmg) · [Intel](https://dl.ferecord.com/latest/Tibi_x64.dmg).

Unsigned builds: right-click the app in Finder → Open the first time.

## Getting started

1. Open Tibi, tell it what to call you and what you usually read.
2. Read one of the built-in sample articles, or paste an English URL into the box on the home page.
3. For summaries, meanings in context and chat, connect a model in **Settings → Models**. [DeepSeek](https://platform.deepseek.com/) is the default suggestion; any OpenAI-compatible service works. Reading, the dictionary and review all work without a model.

## Privacy

Tibi has no server, no account and no telemetry. It goes online to fetch a page you import, call the model you configured, download the OCR language pack or the Kokoro voice the first time, fetch your feeds, and check once a day for updates and announcements (you can turn this off). See [PRIVACY.md](PRIVACY.md).

## Development

```bash
pnpm install
pnpm core:dev -- --fake-model     # Core dev bridge with a fake model (no network, no cost)
pnpm --filter @tibi/desktop web   # UI in the browser at http://localhost:1420
pnpm dev                          # or tauri dev (needs Rust)
```

See the [developer guide](docs/dev/README.md) (Chinese) and [CONTRIBUTING.md](CONTRIBUTING.md). Design docs live in `docs/` and are kept in sync with the code; current decisions are in [DECISIONS.md](docs/DECISIONS.md).

## Credits

[ECDICT](https://github.com/skywind3000/ECDICT) (dictionary, MIT) · [Open English WordNet](https://github.com/globalwordnet/english-wordnet) (English senses and synonyms, CC BY 4.0) · [Word Atlas](https://github.com/designfuchen/word-atlas) (examples, collocations, usage notes, CC BY 4.0, by Word Atlas contributors) · [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) (scheduling, MIT) · [Tauri](https://tauri.app/) · [pdf.js](https://mozilla.github.io/pdf.js/) · [Tesseract.js](https://github.com/naptha/tesseract.js) · [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (voice, Apache-2.0) · [Mozilla Readability](https://github.com/mozilla/readability) · [pi](https://github.com/earendil-works/pi) (agent runtime)

## License

[MIT](LICENSE)
