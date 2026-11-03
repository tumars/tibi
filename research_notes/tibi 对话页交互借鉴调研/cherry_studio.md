# Cherry Studio chat page: interaction patterns and reception (as of 2 Nov 2026)

Version context: the latest release is v2.1.10, 31 Oct 2026 ([releases](https://github.com/CherryHQ/cherry-studio/releases)). Cherry Studio 2.0 shipped on 5 Aug 2026 and is positioned as moving "from Chat to a workspace for finishing work" ([Woshipm, 21 Aug 2026](https://www.woshipm.com/ai/6452200.html); this is the only source I found for the date). The docs at docs.cherry-ai.com now 301-redirect to docs.cherryai.com.cn. Pre-2.0 reviews and issues describe a different UI and are flagged as old where used. The app's v2 chat was not run hands-on: everything below comes from docs, release notes and issues.

## Composer: attachments, mentions, multi-model, phrases, tools, parameters

### Takeaway
After years of toolbar sprawl, v2 reduces the composer to 4 pinned tools plus a "+" panel (also opened with `/`), with pinning that the user can customise for each surface. For Tibi, this small default with an overflow panel is the most directly reusable pattern. Cherry's remaining problems are unclear tool state and approval cards that interrupt typing.

### Cited Findings
- **Default toolbar:** New chat, Web search, Knowledge base and "+". The docs say the toolbar "only includes 4 common tools by default" — [Chat docs](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/chat)
- **"+" panel, also opened by typing `/`:** Upload attachment, Generate image, Prompt management, MCP, Reference note, Clear context, Custom toolbar. Keyboard: up/down to select, Tab or Enter to confirm, Esc to close — [Chat docs](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/chat)
- **Right side of the composer:** expand/collapse for long text, a Thinking dropdown (shown only for reasoning-capable models), and Send. An estimated token count is optional, under Settings → Appearance — [Chat docs](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/chat)
- **`@` meaning:** the current docs say `@` quotes an existing topic into the conversation, not a model — [Chat docs](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/chat). Multi-model selection is documented as ticking models in the model selector — [Compare docs](https://docs.cherryai.com.cn/advanced-basic/chat/model-compare-branches.md)
- **Per-surface toolbars:** Chat, Agent, Quick Assistant and Drawing support different tools, and Chat and Agent pinned layouts are saved separately — [Composer docs](https://docs.cherryai.com.cn/docs/en-us/advanced-basic/workbench/composer-efficiency.md)
- **Clear context** keeps messages visible but stops the model from referring to earlier content. Nothing is deleted — [Chat docs](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/chat)
- **Knowledge base in chat:** selected through "+", with the chosen library names shown in the input area. The entry needs a tool-calling model, and selection is disabled while an attachment is present — [KB docs](https://docs.cherryai.com.cn/knowledge-base/chat.md)
- **Parameters are per assistant, not per chat:** temperature 0.7, Top P 1, context override, max tool rounds 100 (range 1–1000), MaxToken, streaming, custom parameters. The model can also be switched from a dropdown at the top of the chat — [Chat docs](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/chat)
- **Queued follow-ups:** messages can be queued while the model replies. The queue can be paused and sends top-down once resumed. A separate "guide" shortcut steers a running Agent — [Context docs](https://docs.cherryai.com.cn/advanced-basic/chat/context-queue.md). Queued messages start collapsed and expand from the header (v2.1.7) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Recent composer polish:** file and link tokens sit inline with type icons and favicons (v2.1.8); hold the mouse in a text input to dictate (v2.1.8); text direction follows the prompt (v2.1.7); the MCP shortcut highlights when tools are enabled (v2.1.5) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Complaint, old (v1.2.10, 2025):** "the input toolbar keeps getting longer and looks messy". Commenters proposed merging buttons into a dropdown, but others objected that frequent actions like new topic and clear context should stay one click away. The issue also asked for configurable `/` and `@` triggers — [#5528](https://github.com/CherryHQ/cherry-studio/issues/5528)
- **Complaint, current (v2.1.4):** the MCP icon stays gray while a server is connected, so users cannot tell its state — [#22849](https://github.com/CherryHQ/cherry-studio/issues/22849)
- **Complaint (v2.0.5 dev build):** the tool-approval card replaced the composer, blurring focus and destroying IME composition mid-typing. Its approve/stop buttons also overlapped the composer's stop and effort buttons, inviting misclicks. The reporter proposed rendering the card above the input — [#18740](https://github.com/CherryHQ/cherry-studio/issues/18740)

### Inferences
- A pinned set of 3–4 tools plus a `/` panel matches Tibi's needs. Learners should not see provider or MCP concepts in the default composer.
- Any card that asks for a decision (exercise answer, tool approval) should sit above the input and must never steal focus. This matters especially for Tibi's CJK users, who type through an IME.
- A toggle needs to show its state in words or a clear visual. An icon that only lights up was not enough for Cherry's users.
- Parameters belong on a mode or persona (for example "Tutor"), not on each chat. Cherry keeps them at assistant level, and only the model and thinking effort are quick to reach.

### Gaps
- Quick phrases: the docs mention "Prompt management" in the panel, but I could not confirm its v2 behaviour or variable syntax.
- Whether `@` for model mentions survives in v2. The docs describe only topic quoting, and the source tree could not be read in this session (the command was denied by the permission system).
- Whether the #18740 change shipped. The issue is closed, but I did not verify the outcome.

## Thread: message actions, reasoning, tools, citations, rendering, layout, navigation

### Takeaway
Cherry's thread now has message branches with a visual branch manager, multi-select export, editable reasoning, inline context-compression progress and a right-side artifact preview. Its most visible recent quality problem is scroll stability, which recurs in long threads and multi-model layouts.

### Cited Findings
- **Branches:** created from the message menu. A branch keeps the prior context, its later messages are stored separately, and the original route is untouched. A branch manager canvas switches and compares routes, showing nodes and a "current path" legend. Empty branches persist and fill on the next send — [Compare docs](https://docs.cherryai.com.cn/advanced-basic/chat/model-compare-branches.md). Branches can be deleted from the panel (v2.1.9) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Multi-model answers:** each selected model gets a separate request. The docs warn about cost and speed, and advise a short test question first and a single model for simple facts. They also advise putting criteria in the question ("compare on feasibility, risk, cost") — [Compare docs](https://docs.cherryai.com.cn/advanced-basic/chat/model-compare-branches.md). A horizontal multi-model layout exists — [#20090](https://github.com/CherryHQ/cherry-studio/issues/20090)
- **Multi-select:** the action bar exports selected messages as Markdown or Word, or to Notion, Yuque, Obsidian, Joplin or Siyuan (v2.1.4) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Reasoning:** auto-collapse is a global appearance setting — [Chat docs](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/chat). Streamed reasoning is followed and disclosure state is preserved (v2.1.7). Reasoning text can be edited in the assistant message editor (v2.1.9) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Tool results:** image links preview and web links are clickable (v2.1.7). Context-compression progress appears inside the assistant message (v2.1.5) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Errors:** conversation errors carry actionable notifications, a diagnosis, expandable details and recovery actions (v2.1.7). Content streamed before a mid-response failure is kept alongside the error (v2.1.5) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Citations:** knowledge-base answers carry source references, and a source panel shows the source name, snippet and applicable conditions — [KB docs](https://docs.cherryai.com.cn/knowledge-base/chat.md). The docs do not describe the citation's visual form — [Artifacts docs](https://docs.cherryai.com.cn/advanced-basic/chat/artifacts-export.md)
- **Code and diagrams:** appearance settings cover line numbers, collapsing, wrapping, code style and math — [Chat docs](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/chat). Mermaid renders in the background and follows the theme (v2.1.9); diagram previews blend into the message background with unclipped toolbars (v2.1.10) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Artifacts:** clicking one opens a right-side preview for HTML, PDF, Word, PowerPoint, images, text and `.xlsx`, with zoom, download, maximise and view switching — [Artifacts docs](https://docs.cherryai.com.cn/advanced-basic/chat/artifacts-export.md)
- **Layout:** message style is bubble or compact, with a serif font option, font size and a message outline toggle — [Chat docs](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/chat)
- **Long threads:** context usage is viewable, and the docs suggest summarising then starting a new topic — [Chat overview](https://docs.cherryai.com.cn/advanced-basic/chat.md). They recommend a handoff summary of confirmed facts, conclusions, open questions and constraints. Auto-compression defaults on, but the summary does not guarantee every detail survives. Tool outputs over 50,000 characters are stored separately and read in segments — [Context docs](https://docs.cherryai.com.cn/advanced-basic/chat/context-queue.md)
- **Long user messages** expand by default (v2.1.8) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Scroll bugs:**
  - The list jumped to the first message in threads with code blocks (fixed in v2.1.10) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
  - The Agent session page jitters after scrolling up and back down, reported as a recurrence of a family of earlier fixes — [#21700](https://github.com/CherryHQ/cherry-studio/issues/21700)
  - The mouse wheel could not scroll up in the horizontal multi-model layout (a fix is listed in v2.1.5) — [#20090](https://github.com/CherryHQ/cherry-studio/issues/20090), [releases](https://github.com/CherryHQ/cherry-studio/releases)

### Inferences
- Scroll anchoring during streaming deserves early engineering attention. Cherry has had to fix it repeatedly across surfaces.
- Preserving partial output next to an error, with a recovery action, is cheap and suits BYO-model users, whose provider failures are common.
- For a learner, a full branch canvas looks too heavy. Tibi could borrow the data rule (branches never alter the original) and expose only a simple "try again from here" switcher. This is a judgment call, not something tested.
- Multi-model comparison has little direct value for learning. A closer equivalent is comparing alternative phrasings of one sentence, which needs one model and no parallel-column UI.
- Cherry's handoff summary is a useful template for Tibi's long sessions: known words, errors made, current goal.

### Gaps
- The v2 per-message toolbar (copy, regenerate, edit, translate) is not documented on any page I could read. Multi-select and edit are confirmed only through release notes.
- Multi-model layout names (fold, vertical, horizontal, grid), and how one answer is chosen or how context continues, are undocumented. I recall these from v1 but could not verify them, so treat them as unverified.
- The tool-call block's visual design is undocumented. Reading it would need the source or a hands-on run.
- In-thread search and the behaviour of the outline were not described. The global search docs omit in-chat search.

## Organization: assistants, topics, memory, search, mini-window, selection, translation

### Takeaway
The hierarchy is Assistant → Chat, with Agents kept separately under Work. Outside the main window, Cherry offers a hotkey mini window, a system-wide selection toolbar and a dedicated translation page. The selection assistant has the biggest comment thread I found (373 comments), much of it about friction, and language learners are already asking it for faster lookup and phonetics. That makes it the most relevant finding for Tibi.

### Cited Findings
- **Assistant:** a role made of a system prompt and preset parameters. Each chat under it is independent and shares its settings. The Assistant Library offers category filters, search, card previews and an Add button. The edit dialog has Basic, Model, Prompt, Knowledge base and MCP tabs, plus an "AI Optimize Prompt" button. Import works from file, clipboard or URL — [Chat docs](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/chat)
- **Assistants versus Agents:** the docs state that library items are chat assistants, not agents, and agents are managed under Work — [Chat docs](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/chat). Global search warns users not to confuse an assistant with an Agent task of the same name — [Search docs](https://docs.cherryai.com.cn/advanced-basic/workbench/global-search.md)
- **Conversation UI:** tabs show the conversation name and assistant icon, and new tabs open beside the active one (v2.1.9). Hovering shows the full name, activity time and workspace (v2.1.7) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Topic naming:** an old bug had auto-naming use the wrong language — [#5333](https://github.com/CherryHQ/cherry-studio/issues/5333). Stale titles in new remote sessions were fixed in v2.1.4 — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Global search:** covers messages, conversations, tasks, assistants, Agents and knowledge bases, with type and update-time filters. It does not search files on disk — [Search docs](https://docs.cherryai.com.cn/advanced-basic/workbench/global-search.md)
- **Agent memory:** tied to the agent, not to a task or directory. It stores preferences, project facts, decisions and lessons, while one-time progress goes to time-stamped searchable logs. Users correct it by telling the agent, and no dedicated editor is described — [Memory docs](https://docs.cherryai.com.cn/advanced-basic/agent-workspace/permissions-memory-background.md)
- **Global memory:** Cherry's MCP docs point to a global memory feature as the preferred option for persistent memory — [Builtin MCP docs](https://docs.cherry-ai.com/advanced-basic/mcp/builtin). A third-party post says it runs a Memory_Search tool on each user turn and injects snippets into the prompt; this is secondary and unverified — [aimemory.pro](https://aimemory.pro/blog/cherry-studio-vs-ai-memory)
- **Quick Assistant:** Cmd/Ctrl+E opens a mini window over any app, and Esc or an outside click closes it. Options include tray-click launch and reading the clipboard as input (off by default). It handles questions, translation, summaries and explanations — [Quick Assistant docs](https://docs.cherryai.com.cn/cherry-studio/preview/quick-assistant.md)
- **Selection Assistant:**
  - Triggers: select-to-show (default), Ctrl key (Windows), or a shortcut.
  - Actions: Translate, Explain, Summarize, Search and Copy are on by default. Optimize and Quote are opt-in by dragging.
  - Translate falls back to a secondary language when the selection is already in the target language.
  - Custom actions have a name, prompt and default model, and apps can be allow- or blocklisted.
  - macOS needs Accessibility permission, and Linux is fully supported only on X11.
  - All of the above — [Selection docs](https://docs.cherryai.com.cn/cherry-studio/preview/selection-assistant.md)
- **Selection in chat (v2.1.8):** selecting text copies it automatically and shows a quick-quote toolbar — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Translation page:** auto-detect (automatic, local franc, or LLM), a swap button, bidirectional pairs, custom languages, a per-page model picker, and searchable history with favourites. Files are accepted with OCR for images, up to 5 MB for images and text and 20 MB for documents — [Translation docs](https://docs.cherryai.com.cn/cherry-studio/preview/translation.md)
- **Selection feedback** — all from comments in [#6505](https://github.com/CherryHQ/cherry-studio/issues/6505):
  - A reader of foreign articles said select → toolbar → translate → window is too many steps, and asked for a direct inline translation mode.
  - Another user asked for American phonetic symbols when translating English.
  - Others asked for a "follow up" button to continue in the main window, and a toggle for showing the original text.
  - Bugs reported include clipboard interference, double-click producing a stray "C" on Windows, and selected text not clearing.

### Inferences
- Tibi's core use case appears here as user demand: one-step lookup with pronunciation, plus a path from a quick result into a full conversation. The missing handoff is a request in #6505 and a good differentiator.
- Auto-copy on selection and global hooks draw the most bug reports in that thread. If Tibi adds a system-wide helper, it should be opt-in and avoid touching the clipboard.
- Agent memory without a dedicated editor would be weak for a learner profile. Learners should be able to see and correct what the tutor believes about them. This is my judgment; I found no user reports about it.
- Having both Assistants and Agents creates a naming burden that even the docs have to explain. Tibi should present one tutor concept.

### Gaps
- Global memory's v2 interface and settings were not found on a current page.
- The in-chat "translate message" action is not covered by the translation page, and I could not confirm it in v2.
- No documentation was found on how topic auto-naming works in v2.
- Quick Assistant handoff to the main window is undocumented.

## Agent mode: steps, permissions, sessions

### Takeaway
Agent is a first-class surface in v2, called Work. It has five permission modes, a right-hand status panel and persistent, resumable sessions. Users still struggle to find the permission settings and object to repeated approval prompts.

### Cited Findings
- **Entry:** [Work] in the left nav. Creating an agent takes four steps (basic info, persona, skills, knowledge base). The top bar selects Agent, model and working directory in order, and the built-in Cherry Assistant is ready to use — [Agent docs](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/agent.md)
- **Showing progress:** the right panel shows status, files, subtasks and the message stream, with a call chain in developer mode — [Agent docs](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/agent.md). The status panel lists running and completed tasks, subagents, background commands with a stop control, tool success and failure counts, context usage and artifacts — [Memory docs](https://docs.cherryai.com.cn/advanced-basic/agent-workspace/permissions-memory-background.md)
- **Permission modes:** Ask each time, Auto-accept edits, Smart approval, Plan only, Full access. Availability varies by runtime: Pi has no Plan only and DeepSeek Harness has no Smart approval — [Memory docs](https://docs.cherryai.com.cn/advanced-basic/agent-workspace/permissions-memory-background.md). Enabling Full Access shows a scope confirmation first (v2.1.9) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Mode selection:** the selector is in the session composer toolbar and the agent edit dialog. A change applies to later tool calls and is stored on the agent, per a maintainer triage comment — [#22154](https://github.com/CherryHQ/cherry-studio/issues/22154)
- **Waiting state:** "waiting for approval" appears in the status panel, and an optional system notification opens the conversation — [Memory docs](https://docs.cherryai.com.cn/advanced-basic/agent-workspace/permissions-memory-background.md)
- **Sessions:** the architecture has an independent runtime, persistent execution state, reconnectable streams and resume from saved state, according to one commentator — [Woshipm](https://www.woshipm.com/ai/6452200.html). Conversations can be archived in bulk with a count confirmation (v2.1.9) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Background work:** results return to the originating session with source and delivery status — [Memory docs](https://docs.cherryai.com.cn/advanced-basic/agent-workspace/permissions-memory-background.md)
- **Files:** a pane with tabs and a breadcrumb; right-click attaches a file or folder as context (v2.1.9). File comments enter the message as location chips (v2.1.10) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Interactive cards in chat:** scheduled tasks are managed through an agent chat with an interactive card (v2.1.8) — [releases](https://github.com/CherryHQ/cherry-studio/releases)
- **Complaints:**
  - One user faced a confirmation for every file write, could not find an auto-accept switch, and said the agent stopped when they left the screen. A maintainer replied that the modes already exist — [#22154](https://github.com/CherryHQ/cherry-studio/issues/22154)
  - An "auto-edit" mode reportedly allowed all operations, not only edits — [#17121](https://github.com/CherryHQ/cherry-studio/issues/17121)
  - A contributor asked to unify modes across runtimes — [#18898](https://github.com/CherryHQ/cherry-studio/issues/18898)
  - A safety guard blocked commands containing the standalone word "del", a false positive on Spanish text — [#22854](https://github.com/CherryHQ/cherry-studio/issues/22854)
- **Cost and setup, older docs:** the Agent tutorial warned of high token use and required an Anthropic-type provider and API server in v1.7 — [old Agent docs](https://docs.cherry-ai.com/docs/zhong-wen-fan-ti/advanced-basic/agent). The setup steps are likely outdated in v2.

### Inferences
- Five modes are too many for learners. Tibi's actions are mostly low-risk writes to its own local database, so it could auto-apply them and offer undo instead of asking. This fits its existing recoverable card results.
- Interactive cards in the message stream are becoming Cherry's standard way to combine chat and structured actions, which supports Tibi's current lookup, comparison and practice cards.
- A permission setting that exists but cannot be found behaves like a missing feature: #22154 shows this directly. Put the setting where the prompt appears.
- The status side panel suits long unattended work, not a tutoring chat. Tibi's turns are short, so inline steps would likely be enough.

### Gaps
- The visual rendering of steps and approval cards is undocumented. The linked workspace pages were only partly read.
- The Woshipm architecture claims are second-hand commentary, not checked against source.

## User praise, complaints and clutter

### Takeaway
Praise centres on multi-model comparison and getting broad features in one app. Complaints centre on setup effort, localization and platform-hook bugs. Clutter complaints were strongest for the 2025 toolbar, and v2 appears to answer them, but I found little independent feedback on the v2 UI.

### Cited Findings
- **Praise (Product Hunt, 2024–2026 by relative dates):** side-by-side comparison "saves a lot of time" per one summary of a review. Another compared it with ChatBox, saying it has more functions "while the interface is not overloaded". Another found it easier to set up than OpenWebUI or LibreChat — [Product Hunt](https://www.producthunt.com/products/cherry-studio/reviews)
- **Complaints (Product Hunt):** incomplete translation from Chinese to English — [Product Hunt](https://www.producthunt.com/products/cherry-studio/reviews)
- **ComputerTech review (v1.7.22, Mar 2026, old):** it lists API key management, Electron memory use, sparse English docs and early agent mode as drawbacks. It offers little concrete UI testing and reads as partly generic, so give it low weight — [ComputerTech](https://computertech.co/cherry-studio-review/)
- **Structural critique:** in the old model, search, knowledge base, MCP and model settings were separate controls that users had to combine themselves. v2 moves toward stating a goal and deciding at key points. This is one author's interpretation and is favourable to the product — [Woshipm](https://www.woshipm.com/ai/6452200.html)
- **Clutter in the toolbar:** see [#5528](https://github.com/CherryHQ/cherry-studio/issues/5528) (2025), where button order was also raised as mattering more than count by one commenter.
- **Theme breakage:** themes written for v1 need adapting to the v2 interface — [README](https://github.com/CherryHQ/cherry-studio)
- **Popularity:** 53,178 stars and 2,401 open issues (GitHub's count includes PRs), read from the GitHub API on 2 Nov 2026 — [repo](https://github.com/CherryHQ/cherry-studio)
- **Release pace:** 8 releases from 24 Sep to 31 Oct 2026, many of them UI fixes — [releases](https://github.com/CherryHQ/cherry-studio/releases)

### Inferences
- Cherry's history is a warning for Tibi: each feature added its own composer button until v2 had to reset the surface. A hard cap on pinned controls would prevent the same drift.
- Cherry's fans are power users, and its praise rewards breadth. That does not transfer to Tibi's learners, who need fewer decisions. Copy the mechanics, not the density.
- Cherry's desktop-specific bugs (IME focus, clipboard, scroll) are where polish is won or lost. They are also relevant to Tibi's Tauri app.

### Gaps
- Searches for V2EX, Zhihu and Xiaohongshu-style complaints returned no usable v2 feedback, and GitHub searches for "UI cluttered", "v2 UI feedback" and similar found little. The absence reflects search limits and should not be read as v2 being well received.
- I have no usage or satisfaction data for any feature. Comment counts indicate activity only.
- I did not read the repository source or run the app. Two source-tree and release-body commands were denied by the session's permission system, so the release data comes from the rendered releases page (first 100,000 of about 155,000 characters, down to the start of v2.1.4).
