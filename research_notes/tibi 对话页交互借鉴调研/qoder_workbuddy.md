# Qoder and WorkBuddy: chat and task interaction patterns (as of 2026-11-02)

Scope notes for the report writer:
- **WorkBuddy** = Tencent's desktop AI work agent from the CodeBuddy team. Latest changelog entry seen: 5.9.3, 2026-10-27 ([Changelog](https://www.codebuddy.cn/docs/workbuddy/Changelog)). Docs live on codebuddy.cn (China) and workbuddy.ai (overseas). `workbuddy-by.com.cn` turned up in search and looks unofficial; I did not use it.
- **Qoder is now a product family, and the brief's framing is partly out of date.** The IDE's **Quest window was retired on 2026-10-15** ([notice](https://docs.qoder.com/release-notes/quest-retirement-notice)). Quest's role moved to a standalone desktop app also called **Qoder**, while **Qoder IDE** keeps Ask, Agent and Experts in its Editor window. Latest app release seen: 0.5.1, 2026-10-30 ([release notes](https://docs.qoder.com/release-notes/qoder)). **QoderWork** is a separate desktop product for delivering files, and is the closest Alibaba analogue to WorkBuddy ([QoderWork quick start](https://docs.qoder.com/qoderwork/quick-start)).
- Evidence limits: nothing here comes from running either product. Doc pages were read through a summarizing fetch tool, so UI labels are reliable only as far as those summaries are. Quest material describes a retired surface but remains useful as a pattern. A review at aiho.net calls Qoder a "Google AI IDE", which is wrong, so I excluded it.
- Vendor docs describe intent, not how well a feature works. Reception evidence is mostly individual posts, some of them promotional.

## 1. How does a user start a task, and what is on the empty state?

### Takeaway
Both products use a single composer rather than a form, then add scope controls beside it. WorkBuddy adds more guidance for non-developers: scenario-grouped templates with hover-to-preview ghost text. Qoder asks the user to pick Coding or General up front.

### Cited Findings
**WorkBuddy**
- Task creation is one natural-language input with voice input, a workspace selector at the bottom left, `@` references to files, documents or rules, pasted screenshots, and upload or drag-and-drop — [Create Task](https://www.codebuddy.cn/docs/workbuddy/Create-Task)
- Templates are grouped by scenario (daily office, code development, design/creative). Hover or keyboard focus shows gray preview text in the input, appended after any existing text. It clears on leave, is not sent or saved to the draft, and fills the box only on click — [Create Task](https://www.codebuddy.cn/docs/workbuddy/Create-Task)
- Docs teach a prompt recipe: goal, inputs, output format, constraints. They also give five sample prompts — [Create Task](https://www.codebuddy.cn/docs/workbuddy/Create-Task)
- If no workspace is chosen, results go to a default directory, so a user can start without choosing a folder — [Create Task](https://www.codebuddy.cn/docs/workbuddy/Create-Task)
- Three modes are reported: Craft (do it directly), Plan (propose, then act after confirmation), Ask (answer only, no file operations) — [Tencent Cloud community tutorial, 2026-05-08](https://cloud.tencent.cn/developer/article/2665917). The overview only says the user selects a work mode — [Overview](https://www.codebuddy.cn/docs/workbuddy/Overview)
- Experts are browsed by category from the left sidebar, and you select one to converse with. The tutorial claims 100+ experts, such as legal adviser, financial analyst and counsellor — [tutorial](https://cloud.tencent.cn/developer/article/2665917) (third-party count, unverified)
- First-use onboarding reportedly asks "who are you / who am I", then introduces capabilities — [Woshipm analysis](https://www.woshipm.com/operate/6424317.html)
- Tutorials advise starting in Ask, then moving to Craft, with a small, explicit first task — [search summary of tutorials: Tencent Cloud](https://cloud.tencent.cn/developer/article/2665917) (secondary)

**Qoder / QoderWork**
- The app's top-left switch selects **Coding** or **General**. The sidebar then shows Workspaces or Folders. Coding adds Local/Worktree and branch controls. General can run without a folder — [New task](https://docs.qoder.com/qoder/new-task)
- Composer has Add context, Add attachment, model selector, access permissions, voice input and Live voice. An executor picker at the top chooses an Agent or custom Agent team — [New task](https://docs.qoder.com/qoder/new-task)
- Typing `/` picks skills, or **qoder-helper**, which answers questions about features and settings from inside the conversation — [New task](https://docs.qoder.com/qoder/new-task), [Skills](https://docs.qoder.com/qoder/skills)
- "Open with → Qoder" on a file creates an unsent draft with the attachment already in place — [New task](https://docs.qoder.com/qoder/new-task)
- QoderWork's first run is: click New Task, type an outcome-focused request, press Enter, with General workspace and Standard model as defaults. It may ask one or two clarifying questions on complex requests and skips them on simple ones — [QoderWork quick start](https://docs.qoder.com/qoderwork/quick-start)

### Inferences
- The WorkBuddy hover preview is cheap and well suited to a learner who doesn't know what to ask: it shows the prompt without committing to it.
- "Output format" as a named part of the prompt suits a learning agent too, for example "give me a quiz" versus "explain".
- A built-in helper command (qoder-helper) is a neat way to answer "what can you do?" without a help page.

### Gaps
- I could not find a description or screenshot of the actual WorkBuddy or Qoder home-page layout beyond templates. The Qoder doc explicitly does not cover its empty state or templates.
- No official WorkBuddy page on Craft/Plan/Ask behaviour was retrieved, so the mode semantics rest on third-party sources.

## 2. How is agent progress shown?

### Takeaway
Both converge on a three-pane layout: task list, conversation, and results or monitor. The conversation stays narrative, while durable outputs and machine activity sit in the right panel. Qoder makes the panel configurable per section; WorkBuddy centres it on four output tabs.

### Cited Findings
**WorkBuddy**
- Conversation shows replies, stage notes such as "analyzing data", result summaries and expandable intermediate steps. An MCP-connection count appears while loading, then disappears and is not kept in history — [Conversation](https://www.codebuddy.cn/docs/workbuddy/Conversation)
- Right panel tabs: Artifacts, Web (built-in browser with several tabs), Workspace files, Changes (per-file modifications) — [Results](https://www.codebuddy.cn/docs/workbuddy/Results)
- Artifact card "⋯" menu: open folder, open in default app, **add to chat as a reference**, copy path, save a copy, upload to cloud — [Results](https://www.codebuddy.cn/docs/workbuddy/Results)
- Sharing goes to a link, WeChat or WeCom, and uploads to Library, Tencent Docs, ima or 乐享 — [Results](https://www.codebuddy.cn/docs/workbuddy/Results)
- Long conversations get a vertical navigation bar for jumping between the user's own questions. It is hidden when the conversation area is narrow — [Conversation](https://www.codebuddy.cn/docs/workbuddy/Conversation)
- Replay of a historical session no longer auto-opens artifacts (5.9.1), which suggests auto-open was intrusive — [Changelog](https://www.codebuddy.cn/docs/workbuddy/Changelog)
- Sidebar statuses: In progress, Planning, Pending, Completed, Failed, Archived. Badges: In progress, Completed-unread, Failed, Awaiting confirmation. Collapsed groups show the most urgent badge, ranked Awaiting confirmation > Completed-unread > Failed > In progress — [Task Management](https://www.codebuddy.cn/docs/workbuddy/Task-Management)

**Qoder / QoderWork**
- **Task Monitor** can be a fixed right panel or a floating one, and each section can be toggled. Sections: progress and context (goals, plans, recaps), execution activity (subagents, background processes, side chats, Skills, MCP), results and sources, utilities such as memory updates — [Task monitor](https://docs.qoder.com/qoder/task-monitor)
- **Recap** is an optional summary for resuming an older task, with its own model selector — [Task monitor](https://docs.qoder.com/qoder/task-monitor)
- Docs warn that a paused animation, an offline device or unloaded history does not by itself mean a task stopped — [Task monitor](https://docs.qoder.com/qoder/task-monitor)
- QoderWork's right panel shows a live to-do plan, artifacts in progress and the Skills and MCP servers in use. A finished task gives a written summary plus local files — [QoderWork quick start](https://docs.qoder.com/qoderwork/quick-start)
- Local responses can include **interactive visualizations** (0.4.7) — [release notes](https://docs.qoder.com/release-notes/qoder)
- Recommendation cards at the end of an Agent reply in the IDE (Review Code Changes, Run Feature Test, AI Suggestion) fill the input on click, work on the latest reply only, and vanish on the next send — [Chat overview](https://docs.qoder.com/user-guide/chat/overview)
- A retired Quest pattern: statuses Running, Action Required, Ready, Error; a My Quests kanban; a persistent tiled layout — [Quest overview](https://docs.qoder.com/user-guide/quest/overview)

### Inferences
- Separating "what the agent is saying" from "what it has made" fits a learning agent, where the right panel could hold vocabulary, corrections or a practice sheet.
- The "add to chat as a reference" action is a strong loop-closer: outputs become inputs.
- Qoder's warning about paused animations implies progress indicators can mislead, which is worth designing against.

### Gaps
- WorkBuddy's Conversation page does not describe a to-do list. Whether Plan mode shows one in the current UI was not confirmed. A secondary source describes Start Execution and Adjust Plan buttons ([CSDN](https://aicoding.csdn.net/6a23e25410ee7a33f278a28f.html), snippet only).

## 3. Confirmation, permission, undo, and mid-task steering

### Takeaway
WorkBuddy has the most complete documented model here. Its message queue is editable and reorderable, its rewind and edit actions preview the effect on artifacts, and its default permission boundary is the workspace folder. Qoder has three access levels, a central "Needs Me" inbox and checkpoints.

### Cited Findings
**WorkBuddy**
- **Queue:** messages sent during a run enter a queue above the input, where they can be edited, deleted or dragged to reorder. Clicking send on a queued message guides the session without interrupting current output. Others run in order once output, including tool calls, ends — [Conversation](https://www.codebuddy.cn/docs/workbuddy/Conversation)
- **Stop:** a stop control appears in the input area. After stopping, the user can add instructions, resend or continue — [Conversation](https://www.codebuddy.cn/docs/workbuddy/Conversation)
- **Hover actions on user messages:** copy, rewind, edit. These work on local tasks only and not during a run — [Conversation](https://www.codebuddy.cn/docs/workbuddy/Conversation)
- **Rewind** restores conversation and artifacts to before that message and always confirms. The dialog lists each affected artifact and whether it will be restored or deleted — [Conversation](https://www.codebuddy.cn/docs/workbuddy/Conversation)
- **Edit** resends from that message and confirms only if artifacts changed afterward, offering rollback or continuing from the latest version. Failed edits keep the text. **Refresh** applies to the last reply only — [Conversation](https://www.codebuddy.cn/docs/workbuddy/Conversation)
- **Quote:** text, tables or widgets can be sent with "add to conversation" plus an optional annotation for targeted changes — [Conversation](https://www.codebuddy.cn/docs/workbuddy/Conversation)
- **Follow-ups:** suggested next prompts above the input fill but do not send. Users can request others or turn them off per session. Added in 5.8.0 (2026-10-09) — [Conversation](https://www.codebuddy.cn/docs/workbuddy/Conversation), [Changelog](https://www.codebuddy.cn/docs/workbuddy/Changelog)
- **Permissions:** by default the agent works freely in the workspace and asks when leaving it or for high-risk actions. Each dialog puts the reason in its title and the path or URL below. "Full access" is a toggle below the input — [Permission Modes](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Permission-Modes)
- **Declining** is framed as a route onward: the user can ask for a safer approach, such as listing files first — [Permission Modes](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Permission-Modes)
- **Undo safety net:** one snapshot per file per turn (3000 MB cap, oldest removed first), and deletions go to Trash where possible. Docs still recommend the user's own backups — [Permission Modes](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Permission-Modes)
- **Sensitive data detection** offers allow, allow with encryption or deny on input — [Permission Modes](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Permission-Modes)
- **Loop guard:** suspected looping pauses the tool call before running it, and the paused call costs nothing — [Credits](https://www.codebuddy.cn/docs/workbuddy/Credits)

**Qoder**
- Access options: Ask every time, Auto approve, Full access — [Quickstart](https://docs.qoder.com/qoder/quickstart)
- **Needs Me** inbox (new in 0.5.1, 2026-10-30) gathers questions and approvals, which can be answered in place. Handled items move to history — [Task management](https://docs.qoder.com/qoder/task-management), [release notes](https://docs.qoder.com/release-notes/qoder)
- Edit and resend replaces a message and removes later replies. File rollback uses checkpoints and explicitly does not reverse shell commands, services or external writes — [Task management](https://docs.qoder.com/qoder/task-management)
- Branch tasks fork from an Agent response. **Side tasks** open a separate conversation for related work and are recoverable behind an experimental setting — [Task management](https://docs.qoder.com/qoder/task-management), [Task monitor](https://docs.qoder.com/qoder/task-monitor)
- In QoderWork, follow-ups are queued until the current run finishes — [QoderWork quick start](https://docs.qoder.com/qoderwork/quick-start)

### Inferences
- For a learner, "side task" maps well to a tangent ("what does this word mean?") that shouldn't derail a practice thread.
- WorkBuddy's fill-but-don't-send rule, shared by Qoder's cards, looks like a settled convention worth copying.
- Stating rollback's limits (Qoder) is a good honesty pattern for any "undo".

### Gaps
- Qoder's `/qoder/approval-and-sandbox` and "Send messages" pages were not retrieved, so the approval card UI and queue behaviour in the app are unconfirmed.

## 4. Memory, personalization, and how skills, experts and connectors surface

### Takeaway
Both treat memory as inspectable and editable but keep it mostly in settings rather than in the conversation. Extensions surface through `/`, `@`, automatic matching and a sidebar marketplace. Qoder's "skill evolution suggestions" stand out as a learn-from-use loop with a confirmation step.

### Cited Findings
**WorkBuddy**
- Conversation Memory is on by default, extracts preferences and habits, and is visible only to the user. Entries can be clicked and edited, or changed by saying what to remember or forget. Summaries regenerate nightly — [Memory](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Memory)
- **Import from other AIs:** copy an example prompt into another product, paste the result back, click Add to Memory — [Memory](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Memory)
- Reconstructed architecture: read-only cloud profile, `~/.workbuddy/MEMORY.md`, and a per-workspace daily log plus long-term file — [Woshipm](https://www.woshipm.com/operate/6424317.html) (third-party reconstruction of the system prompt; treat as unofficial)
- Skills: `/skills` lists installed ones, and a marketplace installs them — [tutorial](https://cloud.tencent.cn/developer/article/2665917). Another source says skills are invoked with `@` — [BestHub, via search snippet](https://www.besthub.dev/articles/master-workbuddy-in-three-steps-context-memory-skills-for-a-personalized-ai-assistant-9184f5d1d403). These conflict, or both may work; unverified.
- Connectors, experts and skills can be selected per scheduled task. Buddy Apps are industry packages bundling experts, skills and connectors. Project experts are pinned to the top of lists — search summaries of [Automation](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide), [Buddy App](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Buddy-App), [Project](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project)

**Qoder**
- Settings → Memory separates **Global** and **Project** memory, each toggled independently, with file count and last update shown. Secrets and temporary state should not be stored — [Memory](https://docs.qoder.com/qoder/memory)
- Task Monitor can show memory updates under utilities — [Task monitor](https://docs.qoder.com/qoder/task-monitor)
- Quest's Summary had clickable references to the Repo Wiki, Memory, Skills and MCP used in a task — [Quest overview](https://docs.qoder.com/user-guide/quest/overview)
- Memory can be imported from Codex, WorkBuddy and Remote SSH, and Cloud Agent memory can sync — [release notes](https://docs.qoder.com/release-notes/qoder)
- Skills are matched automatically by description or chosen with `/`. Skill evolution suggestions (optional) appear in the monitor; accepting opens a new conversation to confirm a plan, and the Skill does not change until then — [Skills](https://docs.qoder.com/qoder/skills)
- QoderWork's Extensions hold Expert Kits, Skills and Connectors — [QoderWork quick start](https://docs.qoder.com/qoderwork/quick-start)
- A long-time user relies on automatic memory and clears it only when clearly wrong, which confirms memory errors happen — [徐靖峰, updated 2026-05-21](https://cnkirito.moe/qoder-use-guide/)

### Inferences
- "What was used" references on a reply, as in Quest's Summary, could show a learner which saved weaknesses shaped an exercise.
- Say-it-to-change-it memory plus an editable list is the combination to copy. A nightly rebuild is not a good fit if memory should feel immediate.
- The WorkBuddy import flow is a low-cost way to fill a level or goal profile at onboarding.

### Gaps
- No source confirms an in-conversation "memory saved" indicator in WorkBuddy. Qoder's memory page says nothing about one, or about whether saving is automatic.
- WorkBuddy's Experts page could not be retrieved at the URL tried, so how an expert appears in a thread is undocumented here.

## 5. Scheduled and background tasks, mobile/IM hand-off, concurrency, credits

### Takeaway
Both offer form and chat creation for schedules, local versus cloud execution, phone approvals and run history. Cost is the weakest area: per-message cost is generally not visible in the conversation, and this drives the loudest complaints.

### Cited Findings
**Scheduled tasks**
- WorkBuddy has three creation paths: form, chat (prefills "帮我创建一个定时任务：") and templates. Cards show next run time, and failures show a red marker with the reason on hover — [Automation](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide)
- WorkBuddy run history is a timeline with status, summary and outputs, added as a summary page in 5.7.5 — [Automation](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide), [Changelog](https://www.codebuddy.cn/docs/workbuddy/Changelog)
- Local tasks need the computer on and the client running. Cloud tasks work with the computer off but can't reach local paths. Under default permissions, a run waits for confirmation if the user is away — [Automation](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide)
- Qoder offers Create with Qoder or a form, with **Independent task** (new task per run) or **Merged task** (one accumulating thread) as output. Docs say not to treat a created automation as proof a run succeeded — [Automations](https://docs.qoder.com/qoder/automations)
- Quest's Spec card had a Schedule button (retired surface) — [Spec-driven](https://docs.qoder.com/ja/user-guide/quest/spec-driven)

**Mobile and IM**
- WorkBuddy WeChat: Assistant settings → WeChat integration → scan QR. It then starts tasks, takes follow-ups, approves commands and sends completion notices. It needs the client running and WeChat 8.0.70+, and binding is one-to-one — [WeChat assistant guide, via search summary](https://www.codebuddy.cn/docs/workbuddy/WeixinBot-Guide)
- WorkBuddy also has WeCom integration — [WeCom guide](https://www.codebuddy.cn/docs/workbuddy/Wecom-Guide). QQ, Feishu and DingTalk are claimed by third parties — [tutorials, via search](https://cloud.tencent.com/developer/article/2638189) (not verified in docs)
- Qoder's mobile app pairs by account after enabling on desktop. Users can check progress, add requirements, answer prompts, review plans and approve actions, and the desktop must stay awake — [Remote control](https://docs.qoder.com/mobile/app/remote-control). WeCom integration added in 0.4.9 — [release notes](https://docs.qoder.com/release-notes/qoder)

**Concurrency**
- WorkBuddy can run tasks in parallel, and deleting a running task stops it irreversibly — [Create Task](https://www.codebuddy.cn/docs/workbuddy/Create-Task), [Task Management](https://www.codebuddy.cn/docs/workbuddy/Task-Management)
- Qoder has Open in New Window and side tasks; retired Quest had a kanban and tiled panes — [Task management](https://docs.qoder.com/qoder/task-management), [Quest overview](https://docs.qoder.com/user-guide/quest/overview)

**Credits**
- WorkBuddy: Settings → Plan and Credits shows balance and low-credit reminders; per-task and per-model detail is on the website — [Usage](https://www.codebuddy.cn/docs/workbuddy/Usage). Monthly credits do not roll over — [Credits](https://www.codebuddy.cn/docs/workbuddy/Credits)
- WorkBuddy shows a multiplier next to each model, and default tiers Fast, Balanced and Extreme are listed at 0.21x, 0.65x and 1.20x — [SMZDM, 2026-11-01](https://post.smzdm.com/p/aggwnmlm/)
- Qoder estimates: about 50 credits per Qoder Agent request, 3–4 for Editor Ask, 7–12 for Editor Agent, about 50 per Repo Wiki. Failed model calls are free. Usage detail is on the website — [Credits](https://docs.qoder.com/Credits)

### Inferences
- Merged versus independent output matters for a daily practice: a single accumulating thread may suit a study routine better.
- Failed-run reasons with suggested fixes are good practice for any reminder feature.

### Gaps
- WorkBuddy concurrency limits are not documented on the pages read ("system concurrency control" only).
- I found no evidence of a per-message credit label in either product's conversation. Absence from docs is not proof of absence in the UI.

## 6. Qoder specifics: Ask, Agent, Quest, spec confirmation, context chips, Repo Wiki

### Takeaway
Ask and Agent remain in the IDE, plus Experts. Spec review was a Quest pattern on a surface now retired, and the new app's docs retrieved here do not mention Spec. Its annotate-then-Build gate is still the most transferable idea.

### Cited Findings
- **Ask** answers without modifying code. **Agent** uses tools end to end. Opened with ⌘L; tabs can move to a new window — [Chat overview](https://docs.qoder.com/user-guide/chat/overview)
- **Experts** runs several agents in parallel. In Quest, mode and scenario could not be changed after starting — [Quest overview](https://docs.qoder.com/user-guide/quest/overview)
- **Spec flow:** a Spec toggle under "+" → multiple-choice clarification with **Recommend**, **Continue** or **Skip** → a streamed Spec tab (requirements, design, task breakdown, acceptance criteria) → refine by chat or **annotate specific parts** → **Build**, Schedule, or Goal toggle → To-do List in the conversation, Changed Files in the output area → append requirements anytime → Review panel — [Spec-driven (ja, newest wording)](https://docs.qoder.com/ja/user-guide/quest/spec-driven)
- Doc versions disagree: Japanese says "Build" and includes annotation, while Chinese and English were reported as "Run Spec" — [en](https://docs.qoder.com/user-guide/quest/spec-driven), [zh](https://docs.qoder.com/zh/user-guide/quest/spec-driven) (via search summary)
- The new app has Plan-mode review reachable on mobile and clearer plan approval details in Remote Control — [Remote control](https://docs.qoder.com/mobile/app/remote-control), [release notes](https://docs.qoder.com/release-notes/qoder)
- **Context:** the IDE supports @file, @folder, @codeChanges and @gitCommit. One user treats over 60% context use as a signal to split the task, and avoids compression for fear of losing information — [徐靖峰](https://cnkirito.moe/qoder-use-guide/). The 0.5.1 app improved @ file search, slash-menu categories, input-history reuse and pre-send attachment previews — [release notes](https://docs.qoder.com/release-notes/qoder)
- **Repo Wiki:** generated from More → Repo Wiki with Auto Update, Auto Export and Citation options. Pages are read in a left-nav viewer and Knowledge Cards are extracted. With Citation on, tasks draw on it as needed. Pages are revised with `/knowledge-edit`. Docs tell users to verify critical conclusions against code — [Repo Wiki](https://docs.qoder.com/qoder/repo-wiki)

### Inferences
- A Recommend/Continue/Skip row is a low-effort answer to clarifying questions and maps well to choosing a lesson's level or focus.
- Annotating a plan in place beats re-describing it in chat, for example adjusting a proposed study plan.
- Repo Wiki's analogue would be a generated, browsable, citable knowledge base from the learner's own history; this is my analogy, not a product claim.

### Gaps
- Whether the standalone Qoder app keeps a Spec toggle is unconfirmed. Its release notes summary and new-task page don't mention it. Check before citing Spec as current.
- "Context chips" as a named UI element were not found in the docs read. Their look in the app is unverified.

## 7. What do users praise or complain about?

### Takeaway
Praise centres on delegation and tangible output. Complaints centre on credits, stability in long sessions, and imprecise small edits. Most of this is anecdotal and vendor-neutral long-term reviews are scarce.

### Cited Findings
**WorkBuddy**
- Credit drain is the dominant complaint. One user reported about 12,000 credits in a month — [Toutiao, via search snippet; the page itself could not be loaded](https://www.toutiao.com/article/7634181339318665774/). See also a [CSDN post](https://blog.csdn.net/stereohomology/article/details/161970744)
- Same-job cost differs widely by model and tier: a user test found Balanced about 10x and Extreme about 30x Fast, because higher tiers iterate more. Costs seen as hidden include context caching (130 credits on one overnight task) and re-billed context on follow-ups. Multiplier is "挂牌单价，不是账单总价" — [SMZDM, 2026-11-01](https://post.smzdm.com/p/aggwnmlm/)
- Community advice to save credits: choose low-multiplier models, use Plan first to reduce rework, compress context — [Tencent Cloud community](https://cloud.tencent.com/developer/article/2729900) (search summary)
- Long conversations reportedly lag on rendering, based on a thin single forum thread — [locdd](https://www.locdd.com/t/topic/93654). Changelog entries through October repeatedly address long-session loading and crashes — [Changelog](https://www.codebuddy.cn/docs/workbuddy/Changelog)
- Opinion online is mixed, yet one analyst thinks it is probably the most widely accepted desktop agent, and is unsure why. The same analyst calls the UI very similar to Codex — [Woshipm](https://www.woshipm.com/operate/6424317.html)

**Qoder**
- Praise: forcing a design first reduces rework, and delegation frees the user to do other work — [徐靖峰](https://cnkirito.moe/qoder-use-guide/)
- Long-term Quest user reports severe hallucination, especially on style tweaks, small bugs and component adjustments, plus unrelated edits — [forum, via search summary](https://forum.qoder.com/t/qoder-quest/8617)
- June 2026 thread: Quest lag in long sessions; compression failures; conversations reverting to Auto model after restart; a removed Accept Changes button; review view jumping; 16–24 GB memory use; frequent style changes. An official reply addressed the model items — [forum](https://forum.qoder.com/t/qoder/9303)
- Billing seen as opaque; a user wants input, output and cache-hit token detail, and reports about 7 credits for renaming a macro — [forum, via search summary](https://forum.qoder.com/t/qoder/9465)

### Inferences
- Both products' histories warn that long threads are a performance risk, which a chat page should plan for from the start.
- Model and tier persistence bugs appear in both products (WorkBuddy fix in 5.9.3, Qoder complaint in June), so the selected model is a state users care about.
- Unpredictable cost is the shared trust problem. Showing cost before or during a task seems to be an open opportunity.

### Gaps
- No quantitative satisfaction data or usability studies were found. Qoder thread complaints predate the standalone app and may not apply now.
- I found little independent feedback from non-developer WorkBuddy users on conversation UX specifically; most posts are about cost or are tutorials.
