# OpenAI Codex: conversation interaction and features (as of 2026-11-02)

Context that changes how to read everything below: the standalone Codex desktop app was merged into the ChatGPT desktop app on 2026-07-09, with Chat, Work and Codex modes in one window ([Every](https://every.to/context-window/the-urge-to-merge-chatgpt-and-codex); [Bruce on AI Engineering](https://www.heyuan110.com/posts/ai/2026-07-12-openai-codex-app-guide/)). The docs moved too: developers.openai.com/codex URLs now 308-redirect to learn.chatgpt.com/docs ([Changelog](https://learn.chatgpt.com/docs/changelog)). Docs now say "chat" where older sources say "thread" or "task".

Evidence caveat: docs pages were read through a summarising fetch tool, not verbatim, and I did not use the app hands-on. UI details come from docs text, not from observation. Sources dated before July 2026 are flagged as possibly stale.

## Thread UI: steps, reasoning, tool calls, streaming, review

### Takeaway
Codex collapses each finished subgoal into a one-line summary, and shows a summary of reasoning rather than the raw text. This is liked for scanning long sessions, but it fails when a question to the user loses its context inside a collapsed block, and when "thinking" shows nothing. The review pane's line-level comments that batch back into the chat are the strongest pattern to transfer.

### Cited Findings
**Collapse and steps**
- Collapsible sections appear to hold a subgoal's details while it runs, then shrink to a one-line summary once it finishes. This description comes from forum users, not from docs. A VS Code extension user likes it because long sessions are easier to scan with details still available — [OpenAI community, Aug-Sep 2026](https://community.openai.com/t/messages-are-hidden-by-default-in-the-ui/1390020)
- Complaint: an agent's question appears without its context, because the context sits in the collapsed section above it, so the user must expand to understand what is being asked. Staff asked for examples to check whether useful context is being collapsed — [same thread](https://community.openai.com/t/messages-are-hidden-by-default-in-the-ui/1390020)
- A separate report says the final response may be listed without the steps taken along the way; I read this only as a search summary, not the full issue — [#13133](https://github.com/openai/codex/issues/13133)
- CLI: you can watch commands and diffs as they appear, and search activity stays visible in the transcript — [CLI docs](https://learn.chatgpt.com/docs/codex/cli)
- The CLI transcript gained keyboard-driven selection with word, line and page motions, plus integrated Find (0.166.0, 2026-10-29) — [Changelog](https://learn.chatgpt.com/docs/changelog)

**Reasoning**
- Feature request from Feb 2026: the macOS app showed nothing during thinking, so it felt unresponsive. Users asked for a toggle, collapsed-by-default display and localized labels. One said summaries help evaluate the model's logic. Closed 2026-08-05 with the maintainer statement that "Desktop supports live and retained reasoning summaries" — [#10723](https://github.com/openai/codex/issues/10723)
- Open bug (2026-08-25, Windows): with raw reasoning enabled, only a "Thinking" placeholder shows, and the raw text can vanish on completion — [#40553](https://github.com/openai/codex/issues/40553)
- Users complained that Codex returned heading-only "auto/short" summaries while the API could return detailed ones. One poster said detailed summaries "provide a lot of interesting context" on the work under way — [OpenAI community, July 2026](https://community.openai.com/t/codex-i-miss-the-reasoning-summaries/1386528). A CLI report covers heading-only summaries as well (search summary only) — [#34873](https://github.com/openai/codex/issues/34873)

**Review surface (analogue for approving agent output)**
- The review pane shows diffs switchable between Unstaged, Staged, Commit, Branch and **Last turn** — [Code review docs](https://learn.chatgpt.com/docs/code-review?surface=app)
- Hover a line, press **+**, write a comment, then send a chat message that states intent, for example "Address the inline comments and keep the scope minimal" — [same](https://learn.chatgpt.com/docs/code-review?surface=app)
- Stage or revert works at three levels: whole diff, single file, single hunk — [same](https://learn.chatgpt.com/docs/code-review?surface=app)
- Agent review findings appear as inline comments in the pane, and the review also shows as a turn in the transcript. It can optionally run detached — [same](https://learn.chatgpt.com/docs/code-review?surface=app)
- Diffs can be edited inline since the July 9 release (single independent guide) — [Bruce on AI Engineering](https://www.heyuan110.com/posts/ai/2026-07-12-openai-codex-app-guide/)
- Automatic approval reviews appear in the desktop app as items with a status: Reviewing, Approved, Denied, Aborted or Timed out — [Approvals docs](https://learn.chatgpt.com/docs/agent-approvals-security)

### Inferences
- For a learner, the analogue of the review pane is an inline, span-level surface on agent output: corrections to the learner's sentence or a generated lesson, each accepted or rejected per item, with comments batched back to the agent. "Last turn" maps to "what changed in this round".
- Rule to adopt from the collapse complaint: a question or action request must be self-contained and never rely on collapsed context. Collapse the process; never collapse the ask.
- Show a live one-line status during thinking. An empty wait reads as unresponsive, and the demand was for readable summaries rather than raw reasoning.

### Gaps
- I could not confirm the current exact visual treatment of steps in the desktop thread (labels, elapsed-time display, default expansion state). No docs page I reached describes it. A hands-on check would be needed.
- #13133 and #34873 were seen only through search summaries.

## Steering: queue vs interject, plan, questions, approvals, fork, resume, compact

### Takeaway
Codex treats mid-turn input as two explicit intents: steer (into the current turn) and queue (next turn), with a user-set default. Fork and side chat let users branch without disturbing the main line, and permissions are simple presets with one switch command. The distinction is powerful but confuses users, even with its documentation.

### Cited Findings
**Steer and queue**
- CLI: **Enter** while working injects instructions into the current turn. **Tab** queues a follow-up prompt, slash command or shell command for the next turn — [Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- App: Steer sends a follow-up into the running task; Queue waits and sends it as the next turn. The default is set in Settings > General > Follow-up behavior — [OpenAI staff reply, Aug 2026](https://community.openai.com/t/a-practical-codex-app-steer-workflow-splitting-a-task-into-staged-follow-ups/1377757)
- Confusion: a user expected Steer but saw messages consumed one per turn, which matched Queue — [same thread, March 2026](https://community.openai.com/t/a-practical-codex-app-steer-workflow-splitting-a-task-into-staged-follow-ups/1377757)
- Complaint: answering via the "Queued follow-up inputs" list through a shift+← shortcut felt cumbersome to two users. A third did not share this, using `/goal` for objectives and steering for corrections, added context and changed constraints — [OpenAI community, Sept 2026](https://community.openai.com/t/i-find-this-new-queued-follow-up-inputs-feature-a-little-frustrating/1398627)
- Users asked to extend Steer/Queue to regular Chat and ChatGPT web (title only) — [related threads list](https://community.openai.com/t/a-practical-codex-app-steer-workflow-splitting-a-task-into-staged-follow-ups/1377757)
- Queued agent messages no longer restart work after an interrupt or a switch to Plan mode (0.165.0), which implies this was a prior bug. `codex queue --resume` can resume unloaded threads after queueing (0.166.0) — [Changelog](https://learn.chatgpt.com/docs/changelog)
- Interrupt and resume conflict: a crash was reported on Esc with a steer queued during `/review` (search summary) — [#22815](https://github.com/openai/codex/issues/22815)

**Plan, goals, questions**
- `/plan` toggles plan mode. `/goal` sets a persistent objective, and docs recommend `/plan` first when the outcome is unclear — [Slash commands](https://learn.chatgpt.com/docs/reference/slash-commands); [Long-running work](https://learn.chatgpt.com/docs/long-running-work)
- Goal text is both the first prompt and the completion criteria. A progress row above the composer lets you pause, resume, edit or clear it. Goals keep existing permissions and pause when a decision is needed — [Long-running work](https://learn.chatgpt.com/docs/long-running-work)
- A status recap can come from a side chat without interrupting the main chat — [same](https://learn.chatgpt.com/docs/long-running-work)
- FLAG, older third-party source (April 2026): Shift+Tab cycling through Plan, Pair and Execute, and plan mode enforced by prompt rather than sandbox — [Daniel Vaughan](https://codex.danielvaughan.com/2026/04/08/plan-mode-mechanics/). I did not confirm this against current docs.

**Approvals and sandbox**
- Sandbox modes are `read-only`, `workspace-write` and `danger-full-access`. Approval modes are `on-request`, `never` and `granular`; `untrusted` is retired. Presets are Auto (default for version-controlled folders), Read-only and Full access. Switch mid-session with `/permissions`, for example to read-only for chatting or planning — [Approvals docs](https://learn.chatgpt.com/docs/agent-approvals-security)
- Automatic review sends eligible requests to a reviewer agent: low and medium risk may proceed, critical is denied, and failures block the action. `/approve` allows one retry of a denial — [Approvals docs](https://learn.chatgpt.com/docs/agent-approvals-security); [Slash commands](https://learn.chatgpt.com/docs/reference/slash-commands)

**Fork, side chat, resume, compact**
- `/fork` clones the chat to a new ID and leaves the original unchanged. **Esc Esc** on an empty composer edits the previous user message and forks from that point. `/compact` replaces earlier turns with a summary. `/resume` opens a picker — [Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- `/side` starts a temporary side chat without interrupting the main chat — [Slash commands](https://learn.chatgpt.com/docs/reference/slash-commands)
- Acknowledged approval settings persist across resume and fork, and reasoning-token accounting is preserved to avoid premature compaction (0.166.0) — [Changelog](https://learn.chatgpt.com/docs/changelog)

### Inferences
- Learners should not face a steer/queue decision. A sensible default for tibi is one input that steers while the agent streams, with a visible and editable "will send next" chip if queued. The forum confusion suggests two invisible modes behind a settings default are costly.
- `/side` maps very well to learning: ask "what does this word mean?" during a roleplay or exercise without derailing the main conversation. This looks like the highest-value steering pattern to borrow.
- Edit-and-fork maps to "let me redo my answer": retry a sentence without losing the original attempt, which also gives a before/after learning record.
- A goal progress row maps to a session objective above the composer ("use the past perfect 5 times": 3/5, with pause and edit).
- Permission presets translate to a correction-intensity preset rather than to security, for example "don't interrupt / correct at the end / correct everything".

### Gaps
- No current source describes how clarifying questions render in the app (structured choice UI versus plain text). Search turned up nothing on `request_user_input`.
- The app's interrupt control and the restore-to-composer behaviour after stopping are not documented on pages I reached.

## Composer

### Takeaway
The composer is the command centre: `/` for actions, `$` for skills, `@` for files in the CLI, an Add menu for files and modes, and Tab to accept a predicted follow-up that stays an editable draft. Context usage is on demand rather than always prominent in the docs I could read.

### Cited Findings
- App slash commands include `/approve`, `/archive`, `/compact`, `/fast`, `/fork`, `/goal`, `/init`, `/mcp`, `/memories`, `/model`, `/new`, `/pin`, `/plan`, `/reasoning`, `/rename`, `/review`, `/side`, `/status` and `/usage`. Typing `$` invokes a skill, and enabled skills also appear in the slash list — [Slash commands](https://learn.chatgpt.com/docs/reference/slash-commands)
- ChatGPT web has its own `/` menu showing actions available in the current chat — [Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- CLI: `@` searches workspace files and adds a path; `!` runs a shell command; Up/Down restores draft history; Ctrl+R searches prompt history — [Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- CLI `/presets` gives ten numbered slots for reusable prompts and slash commands, with a keyboard menu (0.164.0). `/model` and `/permissions` accept inline arguments (0.164.0). Reasoning effort can change during a conversation by default on supported models (0.165.0). Image attachments are kept when restoring killed composer text (0.166.0) — [Changelog](https://learn.chatgpt.com/docs/changelog)
- The Add menu mockup shows files and folders, Attach Google Chrome, Goal, Plan mode, and plugin shortcuts — [Features](https://learn.chatgpt.com/docs/features)
- **Composer Predictions** (beta, Pro): after a response, a suggested follow-up appears in the box. **Tab** turns it into an editable draft and never sends it. It uses only the current thread, can be turned off under Settings > General > Composer, and generating predictions does not consume usage — [Composer Predictions](https://learn.chatgpt.com/docs/features/composer-predictions)
- **Dictation vs Voice**: dictation only converts speech into prompt text for you to send. ChatGPT Voice is a live conversation you can interrupt, and it can start tasks, check on them, send follow-ups and report progress while work continues. Only one voice chat can be active at a time. Screen context is macOS-only — [Voice](https://learn.chatgpt.com/docs/features/voice)
- `/status` shows context usage alongside chat ID and rate limits; the CLI footer can show context stats via `/statusline` — [Slash commands](https://learn.chatgpt.com/docs/reference/slash-commands); [Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)

### Inferences
- Composer Predictions are directly transferable, with a pedagogic twist: the suggestion must not do the learner's production work. Consider a hint ("try using 'although'") or a partial draft, and make acceptance an edit rather than a send.
- `$skill` and `/` map to "exercise types" (`/quiz`, `/roleplay`, `/review`). Showing only what is available in the current chat is a good rule for non-technical users.
- Separating dictation from live voice maps to separate learning modes: dictation lets a learner review before sending, which supports pronunciation practice; live voice supports fluency.
- A context meter means little to learners. Handle compaction silently and show a "session summary" instead.

### Gaps
- `@` mentions in the desktop app and IDE were not documented on pages I reached.
- Whether the desktop composer has an always-on context ring: I could not verify this from docs.

## Organization: projects, parallel work, notifications, automations, memory, skills

### Takeaway
Codex is organised around outcome-scoped chats inside projects, with attention managed through an Activity view, statuses and an inbox for scheduled runs. Memory is a background recall layer with per-chat control, deliberately separate from required rules in AGENTS.md.

### Cited Findings
- Start a separate chat per distinct outcome. Chats in a project share files and instructions, each with its own transcript. Pin, rename with outcome-focused titles, archive and search — [Projects](https://learn.chatgpt.com/docs/projects)
- Sidebar mockup: New chat, Pinned, Projects, Recents — [Features](https://learn.chatgpt.com/docs/features)
- "Every thread is a workspace, not a chat", in one guide's framing — [Bruce on AI Engineering](https://www.heyuan110.com/posts/ai/2026-07-12-openai-codex-app-guide/)
- Notifications: turn-completion alerts can be never, background-only or always, with separate toggles for permission and question requests. The sidebar bell opens **Activity**, listing chats that are unread, running or waiting for a response — [Notifications](https://learn.chatgpt.com/docs/notifications)
- A floating **pet** shows statuses Running, Needs input, Ready and Blocked while you work in other apps — [Notifications](https://learn.chatgpt.com/docs/notifications)
- Scheduled tasks: standalone (each run is a new chat) or in-chat (returns to an existing chat with its context). **Scheduled** works as an inbox where runs with findings appear, with an unread indicator. You create tasks by asking in chat. Docs advise prompts that say what to do each run, how to decide whether to report, and when to stop or ask; and reviewing the first few runs — [Automations](https://learn.chatgpt.com/docs/automations?surface=app)
- Memories: off by default in settings per docs, updated in the background after a chat has been idle, stored as local files, with secrets redacted. `/memories` sets per chat whether it can use and contribute memories. Docs call them "a helpful recall layer", and required guidance belongs in AGENTS.md — [Memories](https://learn.chatgpt.com/docs/customization/memories?surface=app). Possible conflict: Memory v2 is "on by default for fresh profiles" in CLI 0.165.0 — [Changelog](https://learn.chatgpt.com/docs/changelog)
- Docs advise against relying on hand-editing generated memory files as your main control — [Memories](https://learn.chatgpt.com/docs/customization/memories?surface=app)
- Chronicle / Computer History builds memories from screen or app activity on macOS. Neowin reported rate-limit burn and unencrypted local files (April 2026, flagged as possibly stale) — [Neowin](https://www.neowin.net/news/openai-introduces-chronicle-for-codex-a-recall-like-memory-feature-for-developers-on-macos/); [Memories](https://learn.chatgpt.com/docs/customization/memories?surface=app)
- Heartbeat-like self-scheduling: Codex can schedule future work and "wake up" to continue (April 2026) — [VentureBeat](https://venturebeat.com/ai/openai-drastically-updates-codex-desktop-app-to-use-all-other-apps-on-your-computer-generate-images-preview-webpages/). One engineer reportedly bypasses built-in memory for version-controlled files (third-party write-up, low confidence) — [BestHub](https://www.besthub.dev/articles/openai-engineer-s-codex-masterclass-persistent-agents-heartbeats-local-first-memory-652c2396a753)
- `/init` scaffolds AGENTS.md. The project's primary folder is used for discovering AGENTS.md, skills and config — [Slash commands](https://learn.chatgpt.com/docs/reference/slash-commands); [Projects](https://learn.chatgpt.com/docs/projects)

### Inferences
- In-chat scheduled tasks plus an inbox fit spaced repetition: the agent returns to the same conversation with context ("yesterday's three mistakes") instead of a generic push. The "decide whether to report" guidance matters, since silent runs avoid nagging.
- The status vocabulary (Running, Needs input, Ready, Blocked) is simple and reusable. Tibi already has a mascot, and the pet validates mascot-as-status rather than decoration.
- The learner-profile analogue of memory vs AGENTS.md: explicit learner settings (goal, level) as always-on rules, and inferred observations as soft recall, with `/memories`-style per-chat control, such as "don't learn from this chat". Since Codex files are poor as a user control, make learner memory readable and correctable in the UI.

### Gaps
- Plugin and skills marketplace UX was not investigated in depth because it transfers little.
- Cloud-surface thread UI was not read; only CLI cloud commands were seen.
- No page reached describes IDE extension thread UI beyond notifications and project scope.

## What users praise or complain about

### Takeaway
Praise centres on scannable long sessions, parallel work and control while work runs. Complaints centre on the July merge, redesign lag, hidden context and reasoning, and steer/queue friction. Evidence is anecdotal forum and press material, without usage data.

### Cited Findings
**Praise**
- Collapsed subgoals keep long sessions scannable — [OpenAI community](https://community.openai.com/t/messages-are-hidden-by-default-in-the-ui/1390020)
- An Every writer found moving into Work during a meeting seamless, and notes coders still work in Codex with little apparent disruption — [Every](https://every.to/context-window/the-urge-to-merge-chatgpt-and-codex)
- A forum user endorses `/goal` plus steering as a working pattern — [OpenAI community](https://community.openai.com/t/i-find-this-new-queued-follow-up-inputs-feature-a-little-frustrating/1398627)

**Complaints**
- Merge: chats and projects felt buried, along with duplicate apps, broken plugins and unclear limits; Theo Browne called it a "generational fumble" — [Every](https://every.to/context-window/the-urge-to-merge-chatgpt-and-codex). TechRadar reported a negative user reaction — [TechRadar](https://techradar.com/ai-platforms-assistants/christ-almighty-this-is-so-bad-chatgpts-big-app-update-brings-huge-changes-to-your-workflows-and-users-seem-to-hate-it)
- Work and Codex modes often look identical, and their difference was undocumented, per one guide in July — [Bruce on AI Engineering](https://www.heyuan110.com/posts/ai/2026-07-12-openai-codex-app-guide/)
- UI redesign lag (Sept 2026): one user blamed input events re-rendering the whole UI hierarchy, which is user speculation. Another reported version 26.928.20755 fixed "80%", and a heavy user reported no lag. Support followed up on 2026-10-26 — [OpenAI community](https://community.openai.com/t/the-new-codex-app-ui-redesign-is-insanely-laggy/1401335?page=2)
- Hidden context and reasoning, and queue-answer friction: see the sections above.

### Inferences
- A chat page can lose trust through latency alone, so long-history rendering performance is a feature in itself.
- Many modes with blurred differences are a recurring cost. Tibi should keep modes few, with visibly different behaviour.

### Gaps
- No quantitative satisfaction data was found. Reddit and X sentiment was seen only second-hand through Every and TechRadar, and I did not read the TechRadar article in full.
