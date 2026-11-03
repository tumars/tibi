# Claude Code conversation interaction and harness features (as of 2026-11-02)

Evidence notes:
- Docs were fetched 2026-11-02. The changelog's newest entry was v2.1.316 (2026-10-31). The locally installed CLI is 2.1.215, so it is older than the docs. Nothing here was hands-on tested in a current CLI.
- Docs pages carry no dates. Version gates are quoted where the docs give them.
- "First-hand" marks harness tool definitions visible in this research session in the desktop Code tab (for example `update_plan`, `wrap_up`). These have no public URL and may be unreleased or gated.
- Complaint evidence is much weaker than feature evidence: mostly GitHub issues, social posts and secondhand blogs. No usage study or satisfaction survey was found.
- Some long pages were read through a fetch model's summary rather than verbatim (desktop, permission modes, subagents, skills, VS Code, changelog, issue #8477). Details from those pages are less certain than quoted passages.

## Thread: tool calls, task list, thinking, subagents, status, side panes, next-step suggestions

### Takeaway
Claude Code has converged on one rule: the default thread shows prompts, a one-line digest of the work, and the final answer, with detail one gesture away at several levels. The strongest user backlash came when that detail stopped being visible live, not when it was merely collapsed by default.

### Cited Findings
**Tool-call rendering and collapsing**
- Desktop has three transcript views cycled with Ctrl+O: Normal (tool calls collapsed into summaries, full text responses), Thinking (adds thinking; listed only once thinking exists), and Verbose (every tool call and intermediate step). — [Desktop docs](https://code.claude.com/docs/en/desktop)
- The terminal has a separate transcript viewer on Ctrl+O, with a timestamp and model per assistant message. It also expands lines collapsed by default, such as MCP calls shown as `Called slack 3 times`. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- In fullscreen mode, clicking a collapsed tool result expands the call and result together, and only messages with more to show are clickable. — [Fullscreen](https://code.claude.com/docs/en/fullscreen)
- `/focus` shows only the last prompt, a one-line tool summary with edit diffstats, and the final response, and persists across sessions. VS Code's Focus view similarly hides tool calls and thinking. — [Fullscreen](https://code.claude.com/docs/en/fullscreen); [VS Code](https://code.claude.com/docs/en/vs-code)
- Grouping has failure modes worth copying the fix for. v2.1.314 fixed blocked Shell and MCP calls "reading as if they ran in a collapsed tool group". — [Changelog](https://code.claude.com/docs/en/changelog)
- Long-thread navigation: scrolling up pauses auto-follow, a `Jump to bottom` button shows a count such as `3 new messages`, and a dim header shows the most recent prompt above the view, with click to jump. Transcript mode adds `/` search and `{` `}` to jump between prompts. Dialogs needing a response still scroll into view even with auto-scroll off. — [Fullscreen](https://code.claude.com/docs/en/fullscreen)

**Task list**
- The task list is Claude's checklist with pending, in-progress and complete states. Ctrl+T toggles it, it shows up to five tasks, and it persists across compaction. It is explicitly separate from `/tasks`, which shows running shells and subagents. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- By default the task-tracking tools exist only on Opus 4.7, Sonnet 4.6, Haiku 4.5 and earlier. On other models the list stays empty unless opted in with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- First-hand (desktop Code tab): `update_plan` keeps a list pinned under the latest message with short imperative steps of about seven words and exactly one in progress. The tool's instructions require sending it alongside another tool call, so it costs no extra round trip. This session's tool definitions; no public doc found.

**Thinking**
- Thinking is hidden in interactive sessions unless `showThinkingSummaries: true` is set. Adding `verbose: true` renders it inline. Ctrl+O streams it live. Resolution posted 2026-08-17. — [Issue #8477](https://github.com/anthropics/claude-code/issues/8477)
- `ultrathink` runs the turn at xhigh effort and shows in a rainbow in the chat box. Typed mid-work in the terminal, it raises the rest of that turn. — [Changelog 2.1.311, 2.1.316](https://code.claude.com/docs/en/changelog)

**Subagents and background work**
- v2.1.304 changed background subagents to "show as one status line under their Agent card instead of streaming every step into the chat; the full transcript stays in `/tasks`". — [Changelog](https://code.claude.com/docs/en/changelog)
- A panel below the prompt lists subagents. A success row disappears at once with a 30-second `/tasks` hint. Failed or stopped rows stay 30 seconds. Nested agents appear as a tree. — [Subagents](https://code.claude.com/docs/en/sub-agents)
- A background subagent's permission prompt appears in the main session and names the asker. Esc denies that one call without stopping the subagent. — [Subagents](https://code.claude.com/docs/en/sub-agents)

**Status and return-to-session**
- Session recap: after at least 3 minutes away with the terminal unfocused and at least 3 turns, a one-line recap is ready on return, capped at 400 characters and never twice in a row. On by default; `/recap` runs it on demand. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- At a usage limit, the session waits, shows when the limit resets, and continues on its own. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Memory activity appears as small status lines such as "Saved 2 memories" or "Recalled 2 memories". — [Memory](https://code.claude.com/docs/en/memory)
- Desktop sends an OS notification when a session finishes out of view. — [Desktop docs](https://code.claude.com/docs/en/desktop)

**Side panes and artifacts**
- Desktop panes are chat, Changes, Browser, Terminal, Files, Plan, Background tasks, subagent and iOS Simulator. They can be dragged, resized and popped out into a window. — [Desktop docs](https://code.claude.com/docs/en/desktop)
- The `/diff` panel updates live. An `ask` button attaches that file's diff to the next prompt and reads `asked ✓`. A `source` picker shows per-turn views T1, T2. If closed, it stays closed until reopened. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Clicking an HTML, PDF or video path in chat opens it in the Browser pane. — [Desktop docs](https://code.claude.com/docs/en/desktop)

**Next-step suggestions**
- Prompt suggestions: gray text appears in the empty box after a reply. Tab or Right places it and Enter sends, so a stray Enter cannot send it on Desktop. — [Desktop docs](https://code.claude.com/docs/en/desktop); [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Suggestions back off by themselves: `Showing fewer prompt suggestions · use one to bring them back` appears after many are left unused in a row. They are mostly cache reads, so the cost is low. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- "You should know" (off by default, v2.1.287+): a tool-less side agent rereads the conversation and surfaces one note above the prompt with `Learn more / Knew this already / Dismiss`. Each check bills several thousand tokens of instructions in full. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- First-hand (desktop Code tab): `wrap_up` draws a "next step" box with a recap of about 40 words that must say what is not done or verified, at most one question, and 1–2 buttons with the recommended one first. A turn with nothing pending shows the recap alone and no box. This session's tool definitions; no public doc found.

### Inferences
- Tibi should use a three-level ladder rather than one expand toggle: digest line, expandable card, full trace. A learner mostly wants the digest, while the developer or a curious user wants the trace.
- Tool calls should be named in learner terms and show outcomes ("Looked up *ubiquitous*, added to review"). Failed or blocked calls must look different from successful ones even when grouped.
- The docs' distinction between "Claude's checklist" and "running work" is useful. A multi-step lesson plan should be pinned and short, separate from any background job status.
- A return-to-session recap transfers well: "Last time you were practising X, stuck on Y". The 3-turn and 3-minute gates are a good starting point for avoiding noise.
- The back-off rule on suggestions is directly reusable for any coaching chip, because ignored chips should become rarer. Tab-to-place also protects against accidental sends, which matters for practice answers.
- Reasoning about grammar choices could be valuable as teaching content, but this is untested. Claude Code's users value thinking for oversight, which is not the learner's motive.

### Gaps
- Exact desktop rendering of Plan pane and Thinking view: the fetched summary of the desktop page did not cover the Plan pane in detail, and I did not read the page's later part.
- Artifact behaviour in Code sessions: I did not read the [artifacts docs](https://code.claude.com/docs/en/artifacts.md) page. This session's own tool descriptions show publish, comment and watch mechanics only.

## Steering: interrupting, queueing, structured questions, plan mode, permissions, rewind, resume, compact, context

### Takeaway
Steering is treated as a set of low-cost, recoverable actions: messages queue without stopping work, queued text can be taken back, Esc keeps work done so far, and rewind restores the prompt into the input for re-editing. These transfer almost directly to a learning agent, while code-specific permission machinery mostly does not.

### Cited Findings
**Interrupt and queue**
- Enter while Claude works queues rather than interrupts. Queued entries are listed in the conversation and stay gray until Claude starts responding. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- A queued message reaches Claude as soon as current tool calls finish, within the same turn. Commands and shell commands wait for the turn to end. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Ctrl+Enter sends now (v2.1.275+), and in fullscreen clicking the `to send now` hint does the same (v2.1.312). Up takes queued text back into the box to edit. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode); [Changelog](https://code.claude.com/docs/en/changelog)
- Esc interrupts the turn, keeps the work so far, and sends anything queued right away. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- `/btw` asks a side question during a running turn without interrupting. It has no tools, stays out of history, and appears in a dismissible overlay; `f` forks it into a background subagent with tools. VS Code shows a panel; Desktop opens it with Cmd+; . — [Interactive mode](https://code.claude.com/docs/en/interactive-mode); [Desktop docs](https://code.claude.com/docs/en/desktop)

**Structured questions (AskUserQuestion)**
- Each call has 1–4 questions and each question 2–4 options. Each question has a header of at most 12 characters, and each option a `label` and `description`. `multiSelect` is optional. Not available in subagents. — [SDK user input](https://code.claude.com/docs/en/agent-sdk/user-input)
- The docs tell developers to add an "Other" choice whose typed text becomes the answer value, and allow a `response` field when the user dismisses the card and types a general reply. — [SDK user input](https://code.claude.com/docs/en/agent-sdk/user-input)
- Options can carry `preview` in markdown or HTML for visual comparison. Claude includes it only where comparison helps. — [SDK user input](https://code.claude.com/docs/en/agent-sdk/user-input)
- Execution pauses indefinitely until answered. A hook can `defer` so the process can exit and resume later. — [SDK user input](https://code.claude.com/docs/en/agent-sdk/user-input)
- Recent fixes show the edge cases that matter: pasted text lost unless "Other" had focus (2.1.314), typed notes cut off on questions with previews (2.1.304), and an auto-continue timeout firing right after closing a long external edit (2.1.310). — [Changelog](https://code.claude.com/docs/en/changelog)

**Plan mode**
- Plan mode allows reads and blocks source edits until approval. Approval options are "Yes, and use auto mode", "Yes, manually approve edits" and "No, keep planning". Ctrl+G edits the plan directly. — [Permission modes](https://code.claude.com/docs/en/permission-modes)
- VS Code opens the plan as a Markdown document that accepts inline comments as feedback. `/plan fix the auth bug` enters and starts in one step. — [VS Code](https://code.claude.com/docs/en/vs-code)
- The plan is re-injected from disk after compaction. — [Context window](https://code.claude.com/docs/en/context-window)

**Permissions**
- Modes are Manual, acceptEdits, plan, auto, dontAsk and bypass. Shift+Tab cycles in the CLI; Desktop uses a selector under the prompt box. Since v2.1.283, interactive terminal and VS Code sessions start in auto mode by default. — [Permission modes](https://code.claude.com/docs/en/permission-modes)
- Anthropic reports users accept 93% of prompts and names approval fatigue as the reason for a classifier-based auto mode. The article does not explain how the figure was measured. — [Anthropic engineering, 2026-03-25](https://www.anthropic.com/engineering/claude-code-auto-mode)
- After 3 blocks in a row or 20 in total, auto mode pauses and prompting resumes. Blocked actions are listed under `/permissions` → Recently denied, where `r` retries with manual approval. — [Permission modes](https://code.claude.com/docs/en/permission-modes)
- Tab on a permission prompt opens a comment field on Yes or No, so approval can carry feedback. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)

**Rewind and undo**
- Double Esc on an empty input or `/rewind` opens a list of prompts. Actions are restore code and conversation, restore conversation, restore code, summarize from here, summarize up to here, and never mind. Summaries accept optional guidance. — [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- After restoring the conversation or choosing "Summarize from here", the original prompt returns to the input for re-sending or editing. — [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- A checkpoint is created for each prompt that starts a turn, and the 100 most recent are kept. Mid-turn queued messages have no checkpoint and are marked **No code restore**. — [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- VS Code exposes this on message hover, using fork vocabulary: "Fork conversation from here", "Rewind code to here", and both combined. — [VS Code](https://code.claude.com/docs/en/vs-code)

**Resume, compact and context**
- After compaction, the system prompt, output style, root CLAUDE.md, auto memory, plan and skill descriptions come back. Invoked skills return capped at 5,000 tokens each and 25,000 in total. Hook-added context is summarized with the conversation. — [Context window](https://code.claude.com/docs/en/context-window)
- `/compact focus on X` guides the summary. Partial compaction runs through the rewind menu. `/autocompact` sets the threshold. — [Context window](https://code.claude.com/docs/en/context-window)
- Idle compaction summarizes a 200K+ conversation left idle, and the summary is used on the next message if the cache has expired (2.1.314 extended this to VS Code and Desktop). — [Changelog](https://code.claude.com/docs/en/changelog)
- Before resuming an expensive idle conversation, Pro and Max users get a choice: resume anyway, or start new and let Claude look up the previous one (2.1.304). — [Changelog](https://code.claude.com/docs/en/changelog)
- Context usage appears as a percentage in the Desktop session details Context card, with a category breakdown when opened. `/context` prints the breakdown in chat. VS Code has a context indicator in the prompt box. — [Desktop docs](https://code.claude.com/docs/en/desktop); [VS Code](https://code.claude.com/docs/en/vs-code)

### Inferences
- Queue-by-default plus visible gray state is the best-fit pattern for tibi, since learners often add a thought while a reply streams. It must keep queued text visible, because that is the top reported failure (see the last section).
- `/btw` maps very well to "what does this word mean?" during a roleplay or drill, because the answer does not pollute the exercise context. Tibi needs a decision on whether side lookups still feed the learner's vocabulary records even when they stay out of the thread.
- AskUserQuestion's shape suits quizzes, but its purpose differs. It collects preferences where any answer is valid, while a quiz needs correctness, feedback and retry. Tibi should reuse the constraints (short, 2–4 options, always a free-text escape) and add grading as its own card type. Free text may be pedagogically better than options, because recognition is easier than production.
- Rewind with the prompt restored into the input is a natural "try that sentence again" control. Fork vocabulary is less suitable for learners.
- Approval prompts should be rare in tibi. The 93% figure, however measured, suggests routine reversible writes such as saving a word should run and show a one-tap undo. Prompts should be reserved for external or costly actions.
- A raw context meter is likely irrelevant to learners. The useful translation is to pin the learner's goals and current lesson state so they are re-injected after compaction, as Claude Code does with plans.

### Gaps
- No published data on how often users queue, interrupt, rewind or answer AskUserQuestion with free text.
- The issue-tracker mirror page for the Enter-regression report could not be fully fetched, so its details rest on search-result excerpts.

## Composer: slash commands, skills, mentions, images, voice, pickers, output styles, shortcuts

### Takeaway
The composer is a compact command surface: `/`, `@` and paste cover most actions, and mode, model and effort sit in one row under the box. Output styles are the most directly relevant concept, because Learning mode deliberately stops and hands work back to the user.

### Cited Findings
- `/` lists built-in commands and skills. Desktop also exposes it through **+ > Slash commands**, and commands can be sent while Claude works. — [Desktop docs](https://code.claude.com/docs/en/desktop)
- `argument-hint` displays expected arguments during autocomplete. — [Skills](https://code.claude.com/docs/en/skills)
- VS Code groups its `/` menu into sections, including Customize (MCP, output styles, hooks, memory, permissions, plugins), Context and Settings, which makes it a settings hub as well as a command list. — [VS Code](https://code.claude.com/docs/en/vs-code)
- `@` gives fuzzy file search in VS Code, and also `@terminal:name` and `@browser`. In the terminal, `@` plus a letter can suggest other live sessions. — [VS Code](https://code.claude.com/docs/en/vs-code); [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- VS Code attaches selected text automatically and shows the line count with an X to drop it. — [VS Code](https://code.claude.com/docs/en/vs-code)
- VS Code takes images by clipboard paste and files by Shift-drag, with an X to remove an attachment. Desktop uses the **+** button or drag and drop. — [VS Code](https://code.claude.com/docs/en/vs-code); [Desktop docs](https://code.claude.com/docs/en/desktop)
- Voice in the terminal is described as dictation: hold Space to record, or use `/voice tap` for tap-to-toggle. The key is rebindable. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Model picker is Cmd+Shift+I and effort menu is Cmd+Shift+E on Desktop, and both change mid-session. — [Desktop docs](https://code.claude.com/docs/en/desktop)
- `/model` and `/effort` apply immediately rather than queueing. The new effort applies from the next message, or sooner if a message is queued during tool calls. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Optional spell-check underlines words in the prompt only, with a selectable dictionary such as `en_GB`. It is off by default and needs aspell, hunspell or ispell. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Drafts are protected: text cleared with Ctrl+C or double Esc is recoverable with Up. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode); [Checkpointing](https://code.claude.com/docs/en/checkpointing)

**Output styles**
- Built-in styles besides Default are Proactive, Concise, Explanatory and Learning. — [Output styles](https://code.claude.com/docs/en/output-styles)
- Explanatory adds `★ Insight` blocks in the conversation with 2–3 points specific to the codebase or the code written. They are not written into files. — [Output styles](https://code.claude.com/docs/en/output-styles)
- Learning does the same and also hands over small pieces with real design decisions. It marks `TODO(human)` and sends a "Learn by Doing" request with Context, Your Task and Guidance, then stops and waits. When the user is done, Claude gives one Insight about their code and continues. Routine work stays with Claude. — [Output styles](https://code.claude.com/docs/en/output-styles)
- Custom styles are Markdown files with frontmatter. Without `keep-coding-instructions: true` they drop the engineering instructions on the full system prompt, and the docs say a style can turn Claude into something else, such as a writing assistant. — [Output styles](https://code.claude.com/docs/en/output-styles)
- Styles apply from the next message when switched mid-session (since v2.1.251), and they are instructions, not guarantees. — [Output styles](https://code.claude.com/docs/en/output-styles)
- On Desktop, a style is set in a settings file, not a menu; VS Code and the terminal have menus. — [Output styles](https://code.claude.com/docs/en/output-styles)

### Inferences
- "Learn by Doing" is the best single pattern for tibi: a card with Context, Your Task and Guidance, a hard stop, then one targeted Insight on the learner's work. It maps to "write this sentence yourself", and the handover criterion ("a real decision", not routine work) maps to giving learners only productive-effort tasks.
- The "one Insight on your attempt" rule keeps feedback short. Tibi could limit each attempt to a single correction focus and offer more on request. This is a design judgement, not something the sources tested with learners.
- A session-level tone control (Concise, Explanatory, Coaching) may be enough for tibi instead of many toggles. Since styles are not guarantees, hard pedagogy rules such as never giving the answer first should live in code or tool logic.
- Spell-check in the composer is awkward for a language learner: it can help or short-circuit the mistake the tutor should catch. It should depend on mode.
- `@` could reference vocabulary, earlier sessions or a review item instead of files, and auto-attached selection maps to "ask about this highlighted phrase".
- Voice as dictation-into-composer is a cheap first step, but it does not cover speaking practice, which needs a separate flow with pronunciation feedback.

### Gaps
- I did not read the [voice dictation](https://code.claude.com/docs/en/voice-dictation.md) page, so languages, accuracy and model details are unconfirmed.
- No independent evidence was found on whether Learning or Explanatory styles improve skill, or on how widely they are used.
- Image-paste handling in the terminal (pills, limits) was not reviewed in detail.

## Harness extensibility: memory, skills, hooks, MCP, plugins, schedules, background sessions, hand-off

### Takeaway
The harness separates what the user instructs (CLAUDE.md), what the agent learned (auto memory), reusable procedures (skills), and guaranteed behaviour (hooks), and stores memory as plain, editable Markdown. That separation, with its inspectability, is the most valuable idea for a personal tutor harness.

### Cited Findings
**Memory**
- CLAUDE.md is written by the user and auto memory by Claude; both load each session as context, not enforced configuration. To block an action regardless of what Claude decides, the docs point to a hook. — [Memory](https://code.claude.com/docs/en/memory)
- Auto memory has four types: `user`, `feedback`, `project`, `reference`. Claude skips what it can derive or what CLAUDE.md already says, and does not save something every session. — [Memory](https://code.claude.com/docs/en/memory)
- Layout is a `MEMORY.md` index with one line per memory, plus one topic file per memory. The first 200 lines or 25KB of the index load per session, and topic files load on demand. Near the limit, Claude is reminded to shorten it and merge or drop stale entries. — [Memory](https://code.claude.com/docs/en/memory)
- Writes get a `modified` timestamp in frontmatter, which shows how current a fact is to both the user and Claude. — [Memory](https://code.claude.com/docs/en/memory)
- `/memory` lists files, toggles auto memory, opens the folder and opens files in an editor. `/context` shows which loaded. "Remember X" saves to auto memory, while "add this to CLAUDE.md" targets the instructions. — [Memory](https://code.claude.com/docs/en/memory)
- Auto memory is machine-local and not shared across machines or cloud environments, and memory files are excluded from the transcript retention sweep. — [Memory](https://code.claude.com/docs/en/memory)

**Skills**
- Skill descriptions are always in context, with the full body loaded only on invocation. Description text is truncated at 1,536 characters. — [Skills](https://code.claude.com/docs/en/skills)
- Skills can be invoked by `/name`, by automatic match, or by mention mid-sentence, which only gives permission. Frontmatter can restrict invocation to the user or to Claude. — [Skills](https://code.claude.com/docs/en/skills)
- `context: fork` runs a skill in a subagent. `/skill-doctor` reports each skill's context cost and invocation history and flags unused ones. — [Skills](https://code.claude.com/docs/en/skills)

**Hooks, MCP, plugins**
- The docs' decision table: output style for every response, CLAUDE.md for what Claude should know, skill for one kind of task, hook for what must happen every time, subagent for focused work in a separate context. — [Output styles](https://code.claude.com/docs/en/output-styles)
- Plugins bundle skills, hooks, agents, MCP config and output styles, with namespaced `/plugin:skill` names. — [Skills](https://code.claude.com/docs/en/skills); [Output styles](https://code.claude.com/docs/en/output-styles)
- SessionStart hooks matching `compact` can add context again after compaction. — [Context window](https://code.claude.com/docs/en/context-window)

**Schedules and loops**
- Three schedulers exist. Cloud runs without the machine (minimum 1 hour), Desktop runs locally without an open session, and `/loop` is session-bound (minimum 1 minute). — [Scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks)
- Self-paced `/loop` picks a delay of 1 minute to 1 hour after each iteration and prints the delay and reason. Claude can end the loop when done. — [Scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks)
- Natural-language one-shots such as "remind me at 3pm" work. Scheduled prompts fire between turns and never mid-response. — [Scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks)
- Recurring session tasks expire after 7 days to bound forgotten loops, and missed fires collapse to one run with no catch-up flood. — [Scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks)

**Background sessions and hand-off**
- Remote Control keeps execution local and syncs the conversation across terminal, browser and phone. Users can send from any of them, attach images from the phone, and it reconnects after sleep. The computer must stay on. — [Remote Control](https://code.claude.com/docs/en/remote-control)
- Desktop's **Open in > Cloud** continues a session in the cloud, carrying the conversation as a summary, and a dialog states whether files move and whether the local session is archived. — [Desktop docs](https://code.claude.com/docs/en/desktop)
- Dispatch is a persistent Cowork conversation that routes tasks to Code sessions, with phone push when they finish or need approval. — [Desktop docs](https://code.claude.com/docs/en/desktop)
- Switching back shows "Catching up…" while a remote session syncs (2.1.316). Moved sessions see the interrupted tool call marked as outcome unknown (2.1.309). — [Changelog](https://code.claude.com/docs/en/changelog)
- An open cloud session sometimes did not show messages sent from another device until reload (fixed in 2.1.302). — [Changelog](https://code.claude.com/docs/en/changelog)

### Inferences
- The typed memory scheme adapts well: learner profile, corrections and preferences, current goals, and resources. It should sit apart from structured learning data such as SRS state and mistake logs, which need queries rather than prose.
- Memory should be inspectable in product UI, as editable plain text, with "Saved" and "Recalled" chips linked to the entry. For a non-technical learner, a file in an editor is not enough, so this needs a real "What Tibi remembers" page.
- The timestamp and index-size discipline address staleness, which is sharper for learners because proficiency changes. An old "struggles with articles" note can become wrong.
- Tibi can use the docs' decision table as an architecture rule: persona in style, facts in memory, procedures in skills (drill, review, explain), guarantees in code. Learner-facing slash commands can be drill or review skills with argument hints.
- Scheduling transfers as gentle, bounded behaviour: fire between turns, no catch-up flood after absence (no guilt pile), expiry for forgotten routines, and a stated reason when the agent chooses timing.
- Hand-off lessons for desktop-to-mobile: name what carries over, show a catch-up state, and mark interrupted actions as unknown. Remote Control's "computer must stay on" limit is a poor fit for a mobile learner. Local-first sync of state is a better model.

### Gaps
- I did not fetch the hooks, MCP or plugins pages directly; details here come from cross-references on other pages.
- [Agent view](https://code.claude.com/docs/en/agent-view.md) and [routines](https://code.claude.com/docs/en/routines.md) were not read in full.
- `/goal`, Channels and Dynamic Workflows were only seen as references.

## What users praise and complain about

### Takeaway
The best-documented complaints concern loss of visibility and control, especially hidden thinking and hidden file names, followed by message queue reliability and limits. Praise is less well evidenced: third-party guides repeatedly recommend plan mode, but no representative study was found.

### Cited Findings
**Complaints**
- Hidden file actions: v2.1.20 replaced file names with summaries such as "Read 3 files (ctrl+o to expand)". Developers objected that names let them catch wrong context early, audit sensitive access and save tokens. Boris Cherny defended it as noise reduction, and Anthropic then partly reversed by repurposing verbose mode to show file paths. Secondhand: the article cites The Register. — [LavX News, 2026-02-16](https://news.lavx.hu/article/anthropic-s-claude-code-update-sparks-developer-backlash-over-hidden-file-actions)
- Hidden thinking: issue #8477 (opened 2025-09-30, about 337 👍) argued that watching reasoning live lets users stop a wrong path early, and one commenter called it agent "body language". Others said verbose mode was too noisy and wanted a thinking-only option. Closed as completed 2026-08-17 with a settings-based answer. — [Issue #8477](https://github.com/anthropics/claude-code/issues/8477)
- A widely cited analysis tied perceived quality decline to thinking redaction, while a Claude Code team member reportedly said it was an interface-only change. Both claims are contested and I did not verify them, and this is a trust signal rather than a UI finding. — [DEV Community](https://dev.to/simon_paxton/claude-code-lost-its-thinking-budget-and-broke-workflows-d19)
- Queues: reports describe queued messages stuck until restart or removed from the UI without being sent. — [Issue mirror #20860](https://claudeissues.com/issue/20860-bug-sometimes-claude-code-swallows-the-queued-messages); [Aident blog](https://aident.ai/blog/fix-claude-code-queued-input-dropped)
- A report describes a desktop regression where Enter interrupts instead of queueing. Search excerpt only; the page did not load. — [Issue mirror #93239](https://claudeissues.com/issue/93239-bug-enter-now-interrupts-instead-of-queueing-while-claude-is-working-regression)
- Users disagree on the key mapping: some requested the opposite, with Enter to interrupt and Shift+Enter to queue, or an explicit queue mode. Search excerpts; age and status unverified. — [Issue mirror #50246](https://claudeissues.com/issue/50246-feature-request-message-queue-mode-queue-messages-instead-of-interrupting-active)
- Removed plan-mode "clear context and execute" (late March 2026, 2.1.81) was restored as a default after complaints, according to one blogger's account. — [Brunelle, 2026-04-16](https://blog.matthewbrunelle.com/the-claude-coding-vibes-are-getting-worse)
- Fast-drain usage limits, perceived slowness and regressions were reported in April 2026 social posts. The piece itself warns that timelines amplify bad experiences and offers no metrics. — [Hongkiat](https://www.hongkiat.com/blog/claude-code-getting-worse/)
- Fullscreen mode trades native terminal behaviour for smoothness, and the docs name mouse capture as "the most common friction point". — [Fullscreen](https://code.claude.com/docs/en/fullscreen)
- Prompt fatigue: Anthropic itself reports 93% acceptance and approval fatigue. — [Anthropic engineering](https://www.anthropic.com/engineering/claude-code-auto-mode)

**Praise**
- Third-party guides present plan mode as a practical start for spec-driven work, and suggest reviewing the plan before building to prevent broad changes from a misread intent. These are tutorial and marketing-adjacent sources, not user research. — [PromptLayer](https://www.promptlayer.com/glossary/claude-code-plan-mode); [Pulse](https://www.pulse.bot/ai/news/the-most-underrated-claude-code-feature-nobody-talks-about-plan-mode-1a85717f-87eb-45f1-a9d6-75bf917c3088/)
- Multiple-choice questions during planning are described as an efficient way to gather requirements. — [ClaudeCN](https://claudecn.com/docs/claude-code/workflows/plan-mode/)
- Boris Cherny's defence of collapsing was that it reduces noise so users can focus on diffs and bash/MCP output. This is a vendor position, and I found no independent user defending it directly. — [LavX News](https://news.lavx.hu/article/anthropic-s-claude-code-update-sparks-developer-backlash-over-hidden-file-actions)

### Inferences
- The lesson from the backlash is not "don't collapse". It is that a collapsed line should still carry the key noun, since "Read 3 files" removes the very thing people used for oversight. "Looked up *affect* vs *effect*" stays informative and short.
- Live visibility has a purpose: it lets someone intervene before waste. Tibi's users have less need to catch errors, so the equivalent value is trust in corrections ("why is this wrong?"), which should be on demand at the claim.
- Silently losing typed input is the most damaging failure in the record here, since it is the user's own effort. For learners, a lost attempt also loses practice. Queue and draft persistence deserve test coverage.
- Changing defaults on existing users was what produced much of the anger. Any tibi redesign should keep a setting or migrate carefully.
- These sources are power-user developers, so their preference for detail likely overstates what learners want. Treat them as design hypotheses and test with learners.

### Gaps
- No representative survey, retention data or usability study of Claude Code interaction patterns was found.
- Praise evidence is mostly from tutorials and promotional blogs; first-person positive reports from forums were not sampled, so the complaint-heavy balance partly reflects the sources found.
- No evidence was found on non-developer or learner use of these patterns.
- The Register's original article and the full comment threads on the queue issues were not read directly.
