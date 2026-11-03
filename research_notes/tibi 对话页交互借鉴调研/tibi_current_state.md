# tibi current state: chat page and agent harness (code and docs audit, working tree of 2026-11-02)

Citation convention: `file:line` against the working tree, no URLs because this is a local audit. Short paths:
`UI/` = `apps/desktop/src/`; `KERNEL/` = `packages/core/src/kernel/`; `DOMAIN/` = `packages/core/src/domain/`; `DOC00/05/06` = `docs/design/00-concept-design.md`, `05-agent-architecture.md`, `06-interface.md`.

Method limit: files were read directly. Repo-wide grep was blocked by the session permission classifier, so "no X anywhere" claims rest on reading the listed files, not on an exhaustive search. Unread files: `UI/pages/Tasks*`, `UI/pages/Reader*`, `UI/App.tsx`, `DOMAIN/documents/capabilities.ts`, `docs/design/02-ai-assistant.md`. Nothing was executed; bugs below come from reading code, not from reproducing them.

## Working tree: what is uncommitted and chat-relevant

### Takeaway
The uncommitted change brings the `/` menu and a real model picker into the conversation composer. On HEAD (`12d6d51`) the chat composer was a plain textarea plus send/stop, and Home had a fast/deep toggle.

### Cited Findings
- New untracked `UI/components/Composer.tsx` holds `useSlashMenu`, `SlashMenu`, `ActionChip` and `ModelPicker`, shared by Home and ChatThread — `UI/components/Composer.tsx:8,12,39,52,63`; `git diff UI/pages/Home.tsx`.
- The fast/deep `tier` parameter is replaced in the UI by `provider_id`/`model`, through Home, the Chat URL (`?model=`), ChatThread, useChat and chat.send — `UI/pages/Home.tsx:85`; `UI/pages/Chat.tsx:17-19`; `UI/lib/useChat.ts:51,55`; `KERNEL/methods.ts:28,34`; `KERNEL/agent.ts:41,75`.
- `tier` still exists in the `chat.send` schema, but the UI no longer sends it — `KERNEL/methods.ts:28`.
- Tests also changed (`test/kernel/chat.test.ts`, `helpers.ts`; diffs not read). Much of the rest of the 42-file diff appears to be the keychain to `secrets.json` move and `providers.delete`, judging by the diffs read and the file list — `docs/CHANGELOG.md:174`; `git diff --stat`.
- `review/PlayButton.tsx` (untracked) is in the review area; it was not opened and nothing read links it to chat.

### Inferences
- The Composer work is in progress: DOC00 is updated (`DOC00:293`), but `DOC06:213` still lists `tier` without `provider_id`, `DOC00:418` still says Home has a fast/deep toggle, and the CHANGELOG has no entry for it (the only new row is the secrets one, `docs/CHANGELOG.md:174`).

### Gaps
- No build or tests were run, so whether the working tree compiles and passes is unknown.

## Chat UI: what the page does today

### Takeaway
The desktop chat is a clean single-column streaming thread with stop, slash actions, model picker, approval cards and three learning cards. It has no per-message actions at all: no copy, regenerate, edit, retry, branch or feedback. Attachments, voice input and @ mentions are also absent.

### Cited Findings
**Implemented, structure**
- `Chat.tsx` is a 27-line page at `/chat/:id` that takes `?q=&skill=&model=`, strips them from the URL so a refresh does not resend, and renders breadcrumb plus `ChatThread` — `UI/pages/Chat.tsx:9-25`.
- `ChatThread` is shared by the chat page and the reader Tibi panel; `useChat` is also shared by the mobile Today page and panels — `UI/components/ChatThread.tsx:16`; `UI/lib/useChat.ts:9`; `UI/mobile/ui.tsx:44`.

**Implemented, streaming and stop**
- Text streams through `chat.delta`, cards through `chat.block`, tool lines through `chat.tool`, end states through `task.update`/`task.done` — `UI/lib/useChat.ts:66-70`.
- Typing dots show while no text is flowing — `UI/components/ChatThread.tsx:78`.
- While running, the send button becomes stop, which calls `chat.cancel` — `UI/components/ChatThread.tsx:100`; `UI/lib/useChat.ts:81-82`. A cancelled turn shows "已停止" — `UI/lib/useChat.ts:69`.
- Pressing Enter while running is silently ignored; there is no queue or interrupt-and-send — `UI/components/ChatThread.tsx:46`.

**Implemented, rendering**
- Markdown uses react-markdown with GFM, CJK-friendly emphasis and hard line breaks. All headings render as h4; wide tables scroll in their own box; raw HTML shows as text; images reduce to alt text; only http(s) links survive — `UI/lib/md.tsx:6-24`.
- No syntax highlighting, code-copy button or math plugin is configured — `UI/lib/md.tsx:11`.
- Clicking an http link in an answer imports it to the shelf; ⌘/Ctrl-click opens it in the browser — `UI/components/ChatThread.tsx:65-71`.
- Each answer has a footer "Tibi · 查看过程" linking to the run record — `UI/components/ChatThread.tsx:74`.

**Implemented, composer**
- Enter sends, Shift+Enter gives a newline, IME composition is respected — `UI/components/ChatThread.tsx:94-96`.
- `/` menu: only when the whole input is `/xxx`. ↑↓ moves, Enter/Tab picks, Esc closes. The pick becomes a chip above the input, and Backspace on empty input clears it — `UI/lib/slash.ts:21-23`; `UI/components/Composer.tsx:28-34,52`; `UI/components/ChatThread.tsx:95`.
- Hand-typed `/讲解 xxx` also parses — `UI/lib/slash.ts:31-37`.
- Six fixed actions: 导入, 找文章, 讲解, 出题, 学习洞察, 整理记忆. Skills disabled in settings are filtered out — `UI/lib/slash.ts:11-18`; `UI/components/Composer.tsx:16,22`.
- An action applies to the next sentence only — `UI/components/ChatThread.tsx:30,58`. `/导入` runs in the background without touching the thread — `UI/components/ChatThread.tsx:50-55`.
- Model picker lists LLM providers plus "自动", is hidden with no model, and persists only in component state for the current conversation — `UI/components/Composer.tsx:63-88`; `UI/components/ChatThread.tsx:31,38`.

**Implemented, empty state, history, search, errors**
- Empty state in chat is one grey line; ChatThread takes an `empty` prop — `UI/components/ChatThread.tsx:86`.
- Home is the richer entry: fox plus greeting, composer, two suggestion chips — `UI/pages/Home.tsx:144-175`.
- Sidebar "最近": rename inline, delete with confirm (hard delete, irreversible), by hover menu or right-click — `UI/components/RecentChats.tsx:20,43-46,58-62`; `KERNEL/conversations.ts:84-94`. Sidebar lists only conversations with messages and excludes kind `skill` — `KERNEL/conversations.ts:70-72`.
- Titles are the first 40 characters of the first user message; there is no AI titling — `KERNEL/conversations.ts:101`.
- ⌘K searches conversations by title only (SQL LIKE), not message content; its last row is "问 Tibi" — `DOMAIN/search/methods.ts:53-55`; `UI/components/SearchPalette.tsx:14,65-69`.
- Errors render inline; a text regex adds a "去连接模型" link when the message mentions model or key — `UI/components/ChatThread.tsx:79`. `friendlyModelError` maps 401/402/403/404/429/network/5xx to Chinese guidance — `KERNEL/model-errors.ts:4-15`. RPC failures on send go to a toast — `UI/lib/useChat.ts:60`.

**Keyboard**
- Global: ⌘K search, ⌘\ toggle sidebar — `UI/components/SearchPalette.tsx:50`; `UI/components/Shell.tsx:33`. In palette: ↑↓, ↵, ⌘↵ ask Tibi, Tab scope, Esc — `UI/components/SearchPalette.tsx:16`.

**Not implemented (absent from `ChatThread.tsx`, `useChat.ts`, `Composer.tsx`, `Widgets.tsx`, `chatMethods`)**
- Message actions: the message render has only text and the provenance footer, with no copy, regenerate, edit, retry, delete, feedback or timestamp — `UI/components/ChatThread.tsx:72-74`.
- RPC surface is open, send, list, history, cancel, widget_update, rename, delete. There is no edit, regenerate, fork or message-delete method — `KERNEL/methods.ts:20-54`.
- Branching: `messages` is a linear list ordered by `created_at` — `KERNEL/conversations.ts:121-134`.
- Attachments in chat: the chat composer has no attach button or drop handler — `UI/components/ChatThread.tsx:89-102`. Home's "+" and drag-drop import to the shelf rather than attach to a message — `UI/pages/Home.tsx:59,89-121,161`.
- Voice input: none in the composer. TTS exists (system voice or Kokoro) — `UI/lib/tts.ts:3`. In chat it is wired only to the word-card read-aloud button, not to answers — `UI/components/Widgets.tsx:43`.
- @ mentions: none, and deliberately so — `DOC05:292,307`.
- Reasoning display: the agent forwards only `text_delta` — `KERNEL/agent.ts:104`.
- Conversation export, pin, folders and archive: none in `RecentChats.tsx` (menu is rename and delete only, `UI/components/RecentChats.tsx:62`).
- A "new chat" control on the chat page: none in `Chat.tsx`; a new chat starts from Home or ⌘K — `UI/pages/Home.tsx:84-85`; `UI/components/SearchPalette.tsx:68`.

### Inferences
- The largest gap against general AI clients is the missing message action row and any recovery path after failure. The rest of the shell is already close to convention.

### Gaps
- `App.tsx` was not read, so a ⌘N or Esc route handler there cannot be ruled out. Neither `Chat.tsx` nor `ChatThread.tsx` has one, although `DOC00:293` says Esc returns home.
- Reader panel integration was not opened; it is known only through the `ChatThread` comment and the `tibi:ask` event — `UI/components/ChatThread.tsx:16-18`; `UI/components/SearchPalette.tsx:67`.

## Learning cards, tool display and how card results reach the model

### Takeaway
Cards are capability-defined and rendered deterministically from tool results, not generated by the model. Button actions call capabilities directly, with no model call. Their results are stored on the message and reach the model only as a one-line text on the next user turn; they do not trigger a reply.

### Cited Findings
- `capability.widget(result, params)` turns a tool result into a card spec — `packages/core/src/rpc/define.ts:55-56`. Only three define it: `lookup_word` (word), `compare_words` (compare), `create_quiz` (quiz) — `DOMAIN/terms/capabilities.ts:24-28,47-50`; `DOMAIN/review/capabilities.ts:108-118`.
- At most three cards per answer, deduplicated by kind plus summary. A conversion failure is swallowed — `KERNEL/agent.ts:147-156`. Cards appear only when the run has a `conversation_id` — `KERNEL/agent.ts:122-125`.
- Skill prompts tell the model not to restate card contents, only to add context — `KERNEL/skills.gen.ts:30,66`.
- Word card: word, phonetic, part of speech, up to three translation lines, example, 加入生词本 with undo, 朗读 — `UI/components/Widgets.tsx:21-45`. It calls `terms.add` and `system.undo` directly — `UI/components/Widgets.tsx:25,31`.
- Compare card: side-by-side words and examples, static with no actions. The explanation is left to model text — `UI/components/Widgets.tsx:48-56`; `DOMAIN/terms/capabilities.ts:31`.
- Quiz card: choice or cloze one at a time, immediate right/wrong, score page, redo, label "不影响复习排期" — `UI/components/Widgets.tsx:61-97`. `create_quiz` is `perm: 'read'` and does not touch FSRS — `DOMAIN/review/capabilities.ts:84`.
- An error boundary falls back to the card's text summary, so a bad or newer card cannot break the thread — `UI/components/Widgets.tsx:99-104,110`.
- Flow of a card result: card action → `updateWidget` → optimistic `widgetStates` → `chat.widget_update` (state ≤ 8000 chars, result ≤ 300) → persisted into the block — `UI/lib/useChat.ts:34-43`; `KERNEL/methods.ts:42-46`; `KERNEL/conversations.ts:109-119`. Actions before the answer is persisted are buffered and flushed after reload — `UI/lib/useChat.ts:31,47`.
- Next turn the block is flattened to `[界面上显示了卡片：<summary>；用户操作：<result>]` — `KERNEL/conversations.ts:138-141`; `KERNEL/agent.ts:81-84`. Example result: "做了 3/5 题，答对 2 题，错在 X" — `UI/components/Widgets.tsx:70`.
- Tool calls: live, one line "Tibi 正在<capability description>" with spinner then ✓ — `KERNEL/agent.ts:120`; `UI/components/ChatThread.tsx:76`. Arguments and results are not shown. After completion, tool lines disappear because live entries are removed; only the 查看过程 link remains — `UI/lib/useChat.ts:70`; `UI/components/ChatThread.tsx:74`.
- The agent never persists `role: 'tool'` messages; `addMessage` is called for assistant only — `KERNEL/agent.ts:138-142`. The UI filters `tool` anyway — `UI/components/ChatThread.tsx:72`.

### Inferences
- Because the only channel back is text on the next turn, Tibi cannot react when a quiz finishes unless the user types again. The pedagogically useful "you missed X, want one more?" moment does not exist.
- The quiz also records no learning signal beyond the block's state, though the review capability and `quiz_done` event type exist — `DOMAIN/memory/index.ts:111`. Whether anything emits `quiz_done` was not verified.

### Gaps
- No card kinds exist for article recommendation, grammar breakdown, sentence-grade results or stats. `DOC00:295` describes article cards, but `scout` output is plain text with links — `KERNEL/skills.gen.ts:47`.

## Harness: agent loop, tools, skills, MCP, memory, context, permissions, jobs, usage, undo

### Takeaway
A substantial harness exists: durable jobs, a capability registry with three exits, permission modes, taint tracking, audit and undo, budgets, and an MCP server. Its weak points for chat are context management (last 20 messages, no compaction, tool results not retained), sub-skill runs that are effectively invisible in the thread, and undo that is only exposed for some actions.

### Cited Findings
**Loop**
- One skill run = one `pi-agent-core` `Agent`; tibi delegates the model/tool loop to `agent.prompt` and subscribes to its events — `KERNEL/agent.ts:68,88-93,103-131`.
- `checkBudget` runs once per run before the loop — `KERNEL/agent.ts:77`. No per-turn budget check or tibi-side turn cap appears in `runSkill`.
- Providers: DeepSeek via the pi provider, everything else via `openai-completions`, with hard-coded `contextWindow: 128_000`, `maxTokens: 8192` and zero cost — `KERNEL/agent.ts:53-63`. Model choice: explicit `provider_id` first, else tier or default — `KERNEL/agent.ts:48-49`.

**Capabilities**
- One definition, three exits: direct call, agent tool, MCP. `perm` is read, write or confirm; optional `undoable`, `replay`, `widget` — `KERNEL/capabilities.ts:10-15`; `packages/core/src/rpc/define.ts:43-57`.
- Each step is logged as `job_steps` — `KERNEL/capabilities.ts:94-102`.
- `tool_search` loads extra non-internal capabilities into the live run — `KERNEL/capabilities.ts:174-185`. `run_skill` runs a sub-skill with nesting depth 1 — `KERNEL/capabilities.ts:162-172`; `KERNEL/jobs.ts:55-58`.
- No code execution or file tools, by design — `DOC05:183`.

**Skills (built-in only)**
- `tibi` (17 tools), `scout`, `tutor`, `coach`, `insight` (deep tier), `archivist` — `KERNEL/skills.gen.ts:4-116`. User overrides are limited to tier, extra instructions, write permission (tighten only) and enabled — `KERNEL/skills.ts:7-9,27-34,48-55`.

**MCP**
- Tibi is an MCP server only. Reads are on when MCP is enabled; writes are opt-in per tool and then go through approval as a `trigger=mcp` job, returning `pending_approval` after 2s — `KERNEL/mcp.ts:9-14,64-76`. No MCP client appears in `KERNEL/`, so users cannot attach external tools to Tibi.

**Memory and profile**
- System prompt contains: skill body, extra instructions, profile line, up to 20 `profile`/`procedural` memories, tool list and permission mode, state snapshot, 7-day stats, caller context, up to 5 FTS-recalled memories — `KERNEL/agent.ts:166-197`.
- `remember` and `forget` are `perm: 'confirm'` and undoable — `DOMAIN/memory/index.ts:128-146`. Users can list, edit, delete, pause and clear — `DOMAIN/memory/index.ts:89-109`.
- No automatic memory extraction: `archivist` runs only when manually invoked — `KERNEL/skills.gen.ts:115`; `DOC00:410`.

**Context**
- History is the most recent 20 messages by count, not tokens — `KERNEL/agent.ts:80`; `KERNEL/conversations.ts:131-134`. Cards are flattened to summary lines and tool calls are not persisted, so prior tool output is gone on the next turn — `KERNEL/conversations.ts:138-141`; `KERNEL/agent.ts:138-142`.
- There is no compaction or summarization in `agent.ts` or `conversations.ts`. `ConvRow` has a `summary` field, but `toConversation` does not use it — `KERNEL/conversations.ts:7,143-149`.
- No context-usage indicator exists in the chat UI.

**Permission and confirmation**
- Modes `ask | default | auto` — `packages/core/src/rpc/define.ts:25`. UI-origin calls run directly; `read` is automatic; `confirm` asks unless `auto`; `write` asks in `ask` mode or for `write: ask` skills — `KERNEL/capabilities.ts:50-60`.
- So in `default` mode `add_to_wordbook` and `mark_term` (`write`) run without asking, while `remember` asks — `DOMAIN/terms/capabilities.ts:78,94`; `DOMAIN/memory/index.ts:129`.
- There is no change-a-plan capability in the files read.
- Taint: after `fetch_url`/`web_search`, writes and external calls always ask, and "always allow" is withheld — `KERNEL/capabilities.ts:18,57,100`; `KERNEL/jobs.ts:214,237`; `UI/components/ChatThread.tsx:84`.
- Approval card: allow, deny, always allow. The backend also supports `edit`, but chat offers no edit button — `UI/components/ChatThread.tsx:81-85`; `KERNEL/jobs.ts:232`. The card body is a truncated JSON dump of parameters — `KERNEL/capabilities.ts:64-65,113-115`.

**Jobs**
- `jobs` plus `job_steps` checkpoints, pause/resume/cancel/retry, resume on start, approvals persisted, `task.update` throttled — `KERNEL/jobs.ts:6-13,253-291`. Model-unavailable, budget and offline errors become `deferred` — `KERNEL/jobs.ts:175`.
- The run record page has KPIs, approvals, step tree and diagnostics (documented, page not read) — `DOC00:434`; `KERNEL/methods.ts:62-106`.

**Cost and usage**
- Per-turn tokens and CNY cost recorded (fixed `USD_CNY = 7.2`); defaults ¥20/month, ¥1/task — `KERNEL/agent.ts:112-116`; `KERNEL/usage.ts:9-10,39-48`. Shown in the run record and settings, deliberately hidden from the thread — `DOC00:411`; `DOC05:310`.

**Undo**
- `system.undo` with a 10-minute TTL via audit rows — `DOMAIN/shared/undo.ts:11,37-49`. In chat, only the word card has an undo button — `UI/components/Widgets.tsx:41`. Agent-made writes return an `undo` token in the tool result, but the chat renders no such control — `DOMAIN/terms/capabilities.ts:90,96`; `UI/lib/useChat.ts:68`.

### Inferences
- The strongest differentiators already built are taint-gated approvals, deterministic cards and learner-state injection. Harness features most worth comparing are compaction, tool-result retention and turn-level checkpoints or undo.
- The system prompt places volatile state (`today`, UI context) in the system prompt on every turn — `KERNEL/agent.ts:178-180`. That contradicts the cache-oriented layout in `DOC05:168-174` and probably reduces DeepSeek cache hits.

### Gaps
- `pi-agent-core` internals (turn limits, parallel tools, steering) were not inspected.
- `web_search` implementation was not read; `DOC00:418` says the search service is not connected.

## Design intent: philosophy, constraints, non-goals, planned-but-unbuilt

### Takeaway
Tibi is "read what interests you, learn English along the way", with one mascot character exposing verbs rather than agents. Recommendations must not reintroduce agent concepts, @ mentions, custom skills, schedules, hosted services or arbitrary code execution, and should keep process detail collapsed by default.

### Cited Findings
**Philosophy**
- Local-first, AI-native reading tool; first audience is programmers reading English docs — `DOC00:11-13`.
- BYO key, pure open source, no hosting or subscription — `DOC00:27`.
- One character, Tibi; UI names verbs and hides words like FSRS, ECDICT and capability names — `DOC00:402-403`.
- Process visible but collapsed; model, duration, cost and tool calls appear only in 查看过程 and the run record — `DOC00:411`; `DOC05:310` (C5).
- Persona: calm, humorous, encouraging, no lecturing, guide rather than give answers, short replies, one thing at a time — `KERNEL/skills.gen.ts:30`.
- Capability vs skill split: deterministic work is code, judgement is model — `DOC05:84-87`. Offline degrades to skipping AI steps — `DOC05:89`.
- Assistant only nudges at natural breakpoints, never interrupting reading (A5) — `docs/CHANGELOG.md:15`.

**Explicit non-goals**
- No beginner courses or grammar curriculum; no content platform; no social or leaderboards; no accounts or cloud service; no shadowing, custom skills or scheduled routines — `DOC00:20-25`.
- No `@` naming (C2) — `DOC05:307`. No user-installed skills (B5) — `DOC05:144,257`. No schedules (B7) — `DOC05:259`. No ACP client or subscription login in v1 (B6) — `DOC05:223-224,258`.
- No arbitrary code; a QuickJS sandbox only "if needed later" — `DOC05:183`.
- Remote images are banned to avoid leakage — `DOC05:200`.

**Documented but not implemented (or differing from code read)**
- Long-conversation auto-compaction — `DOC05:162`; absent per the section above.
- Volatile context as a per-turn user-message prefix — `DOC05:173`; the code puts it in the system prompt, `KERNEL/agent.ts:178-180`.
- Collapsed process card "Tibi 正在讲解…" expandable to steps — `DOC00:296`; `DOC05:118,294`. Code has flat live lines that vanish, `UI/components/ChatThread.tsx:76`.
- Footer "Tibi · 技能名 · 查看过程" — `DOC00:297,411`; code shows only "Tibi", `UI/components/ChatThread.tsx:74`.
- Sub-conversation for `run_skill` — `DOC05:118,154`; the code passes no `conversation_id`, `KERNEL/index.ts:82`.
- Modify-then-allow in the conversation's approval card — `DOC05:181`; chat has no such button.
- Approval line "将执行 `工具` · 影响" — `DOC00:427`; the chat card shows the impact without naming the tool, `UI/components/ChatThread.tsx:83`.
- Write idempotency keys — `DOC05:157,210`; the `recordUndo` calls read pass none (`DOMAIN/memory/index.ts:134`), though `alreadyDone` exists, `DOMAIN/shared/undo.ts:31`.
- Rotating placeholder examples and scene-aware chips — `DOC05:293`; Home has two fixed chips, `UI/pages/Home.tsx:172-175`.
- Results cards for imports in the conversation page — `DOC00:294`; `/导入` from chat only toasts, `UI/components/ChatThread.tsx:53-54`.
- Tainting for imported text — `DOC05:187-188` treats imported text as untrusted; code marks taint only for `fetch_url`/`web_search`, `KERNEL/capabilities.ts:18,100`.
- `06 §8` open questions: `chat.send` context reporting, and WebSocket vs stdio — `DOC06:465,468`.

### Inferences
- A learning-specific message action (for example "explain simpler" or "add to wordbook") would fit the verb model better than generic agent-style controls. A collapsed process card would fulfil an already-stated design rather than add a new concept.

### Gaps
- `docs/DECISIONS.md` and `02-ai-assistant.md` were not read; they may record further decisions on context and memory.

## Relation of mobile and Home to chat

### Takeaway
Home is the desktop entry that routes input to import or a new chat. Mobile shares the logic hook and cards but is a reduced thread: one conversation per day, no stop, no slash, no model picker.

### Cited Findings
- Home classifies input: URL or long English imports, otherwise opens a new conversation and navigates with `?q=` — `UI/pages/Home.tsx:67-87`. Slash and model choice carry over — `UI/pages/Home.tsx:85`.
- Mobile Today opens the single `today` conversation, with the thread under the cards and a dock input — `UI/mobile/Today.tsx:25,58,60-65`; `KERNEL/conversations.ts:45-50`; `DOC00:449`.
- Mobile `Thread` uses `useChat` and `Blocks`, so cards work — `UI/mobile/ui.tsx:44,53-56`.
- Mobile lacks: stop (does not destructure `running`/`cancel`), 查看过程, connect-model link, always-allow — `UI/mobile/ui.tsx:44,53-61`. Its link click always imports, with no modifier path — `UI/mobile/ui.tsx:49-51`. The input is a single-line `<input>` — `UI/mobile/Today.tsx:61`.
- Same conversation syncs across devices, labelled "· 手机" on desktop — `UI/components/RecentChats.tsx:16`; `DOC00:449`.
- Scope is deliberately read, review and ask, with settings and task management staying on desktop — `DOC00:446`.

### Inferences
- Because mobile `submit` has no running gate, two sends can overlap — `UI/mobile/Today.tsx:29-33`. The backend `chat.send` does not reject concurrent runs either — `KERNEL/methods.ts:29-37`.

### Gaps
- `UI/mobile/Reader.tsx` panels and "我 › 对话记录" in `Me.tsx` were not read.

## Visible gaps, rough edges and probable bugs

### Takeaway
Most real defects cluster around interrupted or backgrounded runs: partial answers are lost, leaving and returning loses the live state, and failures have no in-thread retry. None was reproduced; each is reasoned from code.

### Cited Findings
Directly visible from code:
1. Failed tools show ✓: the tool-end event carries `summary: '出错了'`, but the UI only flips `done` and renders ✓ — `KERNEL/agent.ts:126`; `UI/lib/useChat.ts:68`; `UI/components/ChatThread.tsx:76`. Denied approvals follow the same path.
2. Forced auto-scroll: any change to msgs, live or approvals pins to the bottom, so scrolling up during streaming is overridden — `UI/components/ChatThread.tsx:37`.
3. Partial answers are lost on stop or error: `runSkill` throws before `addMessage` — `KERNEL/agent.ts:135-142`. The user message remains, so the model later sees an unanswered turn. Text from earlier successful turns in the same run is lost too.
4. Leaving and returning loses the run: conversation change clears `live`, `approvals` and `mine` — `UI/lib/useChat.ts:49`. Events for other tasks are then ignored, including `task.done`, which is what triggers reload — `UI/lib/useChat.ts:68-71`. No in-flight state is restored by `chat.open`. DOC00:293 promises the run continues; the answer would only appear on a later reopen.
5. Pending approvals vanish from the thread after navigating away for the same reason; the sidebar badge and run record remain — `UI/lib/useChat.ts:49,71`; `UI/components/Shell.tsx:28,52`.
6. Sub-skill output is effectively invisible when Tibi uses `run_skill`: no `conversation_id`, so no streaming to the thread and no cards — `KERNEL/index.ts:82`; `KERNEL/agent.ts:122`; `UI/lib/useChat.ts:66-67`. Its approval has a child `task_id` not in `mine`, so the card does not appear in chat — `UI/lib/useChat.ts:56,71`. `wait` is optional; without it the model receives only `task_id` — `KERNEL/index.ts:74`.
7. No retry from thread: `tasks.retry` exists, but ChatThread has no retry control — `KERNEL/methods.ts:92`; `UI/components/ChatThread.tsx:79`. Even if retried from the run record, the open thread would not refresh, per item 4.
8. Stale error placement: error live entries persist and render after all `msgs`, so an old error appears below newer user messages — `UI/lib/useChat.ts:70`; `UI/components/ChatThread.tsx:72-79`. They also disappear on reopen because errors are not persisted.
9. Budget and connect link mismatch: only text matching `连接模型|API Key|model` gets a link; budget-exceeded text has no settings link — `UI/components/ChatThread.tsx:79`; `KERNEL/usage.ts:43`.
10. Custom providers report zero cost: `cost` is hard-coded to 0, so unless the provider reports a cost, budgets never trip and spend shows ¥0 — `KERNEL/agent.ts:62,112-114,159-162`.
11. `complete.ts` emits `month_cost: cost`, this call's cost rather than the month's — `KERNEL/complete.ts:37`, compare `KERNEL/agent.ts:117`.
12. Global UI context: `setUiContext` is one process-wide value; concurrent conversations overwrite each other, and resumed jobs lose it — `KERNEL/methods.ts:31`; `KERNEL/index.ts:61,86`. Selection is dropped unless `sentence_id` is also present — `KERNEL/capabilities.ts:155`.
13. Word card undo button outlives the 10-minute TTL and then only toasts an error — `UI/components/Widgets.tsx:30-33,41`; `DOMAIN/shared/undo.ts:41`. `in_wordbook` is a snapshot from card creation — `DOMAIN/terms/capabilities.ts:27`.
14. Link click imports every http link in answers, including incidental references, with no confirmation or hint — `UI/components/ChatThread.tsx:65-71`.
15. Empty conversations: each Home ask calls `chat.open {}` and creates a row even if later unused; the list filter hides them, but rows accumulate — `UI/pages/Home.tsx:85`; `KERNEL/conversations.ts:51,70-72`.
16. Only the newest 50 messages load: `chat.open` uses `limit: 50`, and `useChat` has no load-more — `KERNEL/methods.ts:22`; `UI/lib/useChat.ts:47`. `chat.history` has a cursor, but no caller exists in `useChat`/`ChatThread`.
17. History cursor uses `created_at` and can skip messages sharing a millisecond — `KERNEL/conversations.ts:123-127`.
18. Sequential user messages after a failure are sent as consecutive user turns — `KERNEL/agent.ts:81-85`. Some OpenAI-compatible backends may be strict about this (untested).

### Inferences
- Crash resume likely repeats tool calls: the checkpoint name includes `toolCallId`, which a restarted run would regenerate, so `step()` cannot match the earlier one — `KERNEL/capabilities.ts:94`; `KERNEL/jobs.ts:107-108`. `record_review` is `replay: 'never'`, yet `kernel` files read never consult `replay` — `DOMAIN/review/capabilities.ts:68`. This would contradict the `DOC05:157` claim that writes will not repeat. The inference fails if an unread file reads `replay`.
- FTS recall with Chinese queries may be weak: the query splits on whitespace, so an unspaced Chinese sentence is one quoted token — `KERNEL/agent.ts:189-193`. The FTS tokenizer config was not checked.
- A 20-message window, with an approximately fixed system prompt, makes context overflow unlikely but gives abrupt forgetting in long tutoring threads.

### Gaps
- None of these was reproduced in the running app. `--fake-model` is available to do so: `卡片 查词|辨析|练习` drives the cards offline — `KERNEL/devfake.ts:31-35`; `README.md:58`.
- Whether the Tasks page exposes undo for agent writes is unverified.
