<p align="center"><img src="docs/prototypes/img/logo.svg" width="72" alt="Tibi"></p>

<h1 align="center">Tibi</h1>

<p align="center"><b>Read English articles you actually care about, and learn the language along the way.</b><br>An English reading app for Chinese-speaking learners: local-first · AI-native · open source</p>

<p align="center">
<a href="https://github.com/tumars/tibi/releases"><img src="https://img.shields.io/github/v/release/tumars/tibi?include_prereleases&label=download" alt="Download"></a>
<img src="https://img.shields.io/badge/macOS-13%2B-black?logo=apple" alt="macOS 13+">
<a href="LICENSE"><img src="https://img.shields.io/github/license/tumars/tibi" alt="MIT"></a>
</p>

<p align="center"><a href="https://tibi.ferecord.com/">Website</a> · <a href="README.md">中文</a> · English · <a href="docs/guide/README.md">User guide (Chinese)</a> · <a href="https://github.com/tumars/tibi/releases">Download</a></p>

![Reader: new words are marked for your level; click one to see what it means in this sentence](docs/img/screenshots/reader.jpg)

> Tibi is built for people whose first language is Chinese: dictionary entries, AI explanations and the default interface are in Chinese. The interface can be switched to English in **Settings → General → Interface language**; to have Tibi explain in English, just tell it so in a chat.

## Why Tibi

- **Read real things**: the blogs, news, docs and books you already want to read, not textbooks.
- **Stay in the flow**: click a word to see what it means in this sentence; review later.
- **Your data is yours**: no server, no account, everything stays on your computer; AI runs on your own model key.

## What it does

**Read**

- **Import almost anything**: web pages, pasted text, EPUB (with illustrations), PDF, Word, images and scanned PDFs (local OCR), plus a browser clipper extension.
- **Feeds and article picks**: subscribe to English blogs and magazines (RSS / Atom) and new posts show up on their own; or ask Tibi to pick something that matches your interests.
- **Click a word to understand it**: the word card shows its meaning *in this sentence* (AI-generated, cached), the ECDICT entry, phonetics and pronunciation.
- **A dictionary at hand**: works offline, understands inflected forms, Chinese lookups and misspellings; examples come from articles you've read.
- **AI reading help**: a one-click summary, key phrases, hard sentences and reading advice; a full translation; select a passage to ask Tibi and keep asking in chat.
- **Read aloud**: system voices or a local neural voice (Kokoro), sentence-level highlighting, speed control, sentence loop.

**Learn**

- **You decide what's new**: no level test and no guessing. Only words you've marked as new or are learning get highlighted.
- **Remember what you read**: new words go into spaced repetition (FSRS) using the sentences you actually read, plus dictation, spelling, confusable-word and sentence-writing practice.
- **See your progress**: known words, daily reading, review performance, a study calendar, and a short note from Tibi.

**Your data**

- **Stored locally**: everything lives in a local SQLite database; model API keys are kept in a separate file, outside the database and backups. Export, back up and restore any time.
- **Sync across devices**: via iCloud Drive, any synced folder, or WebDAV (Nextcloud, Jianguoyun, …); changes are merged, never overwritten.
- **Works with other AI tools**: a built-in MCP server lets Claude Code, Codex and others read your progress and add words (writes need your approval).

<table><tr>
<td><img src="docs/img/screenshots/home.jpg" alt="Home"></td>
<td><img src="docs/img/screenshots/words.jpg" alt="Word list"></td>
</tr></table>

## Install

Tibi is currently available for Apple silicon Macs running macOS 13 or later. Download from [Releases](https://github.com/tumars/tibi/releases):

| Chip | File |
|---|---|
| Apple silicon (M series) | `Tibi_x.y.z_aarch64.dmg` |

If GitHub is slow, use the mirror: [Apple silicon](https://dl.ferecord.com/latest/Tibi_aarch64.dmg) · [SHA-256 checksums](https://dl.ferecord.com/latest/SHA256SUMS.txt)

Release builds are signed and notarized by Apple and open normally. For your own or unsigned builds, right-click the app in Finder → Open the first time.

Intel Mac, iOS, Windows and Linux versions are on the way.

## Getting started

1. Open Tibi, tell it what to call you and what you usually read.
2. Start with a built-in sample article or book, or paste an English URL into the box on the home page.
3. For summaries, meanings in context and chat, connect a model in **Settings → Models**. [DeepSeek](https://platform.deepseek.com/) is the default suggestion; any OpenAI-compatible service works.

Reading, the dictionary and review all work without a model.

## Privacy

Tibi has no server, no account and no telemetry. It only goes online to:

- fetch a page you import and refresh your feeds;
- call the model you configured (content goes only to the provider you chose);
- download the OCR language pack or the Kokoro voice the first time you use them;
- check once a day for updates and announcements (you can turn this off);
- reach the sync location you chose, if you turn sync on.

See [PRIVACY.md](PRIVACY.md).

## Development

```bash
pnpm install
pnpm core:dev -- --fake-model     # Core dev bridge with a fake model (no network, no cost)
pnpm --filter @tibi/desktop web   # UI in the browser at http://localhost:1420
pnpm dev                          # or tauri dev (needs Rust)
```

Requires Node 22+ and pnpm. See the [developer guide](docs/dev/README.md) (Chinese), [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Design docs live in `docs/` and are kept in sync with the code; current decisions are in [DECISIONS.md](docs/DECISIONS.md).

## Credits

[ECDICT](https://github.com/skywind3000/ECDICT) (dictionary, MIT) · [Open English WordNet](https://github.com/globalwordnet/english-wordnet) (English senses and synonyms, CC BY 4.0) · [Word Atlas](https://github.com/designfuchen/word-atlas) (examples, collocations, usage notes, CC BY 4.0, by Word Atlas contributors) · [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) (scheduling, MIT) · [Tauri](https://tauri.app/) · [pdf.js](https://mozilla.github.io/pdf.js/) · [Tesseract.js](https://github.com/naptha/tesseract.js) · [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (voice, Apache-2.0) · [Mozilla Readability](https://github.com/mozilla/readability) · [pi](https://github.com/earendil-works/pi) (agent runtime)

## License

[MIT](LICENSE)
