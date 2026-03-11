# Velocity Development Flow

> **Init Session**: `e3d2bce7-a88c-456f-b6d4-bd7e3684bdb5`

## Overview

Multi-agent development workflow for **Velocity**, a modern Windows terminal built with Tauri + React/TypeScript. Inspired by the [SLAWK methodology](https://ncvgl.github.io/posts/slawk/).

The core idea: a persistent CTO session plans and delegates, ephemeral agent sessions execute, and the human acts as the exception handler and final approver.

---

## Agent Roles

| Agent | Session | Lifespan | Purpose |
|-------|---------|----------|---------|
| **CTO** | Persistent | Days | Plans features, writes dev prompts, reviews work, triages bugs. Never writes code. |
| **Developer** | Ephemeral | 1 feature | Explores codebase, writes tests, implements, commits. Fresh context every time. |
| **Code Reviewer** | Ephemeral | 1 review | Reviews git diff for quality, patterns, and correctness. |
| **Security Reviewer** | Ephemeral | 1 review | Dedicated security audit — command injection, IPC attack surface, escape sequence exploits. |
| **QA** | Ephemeral | 1 cycle | Runs tests, analyzes code for bugs, writes manual test plans, files issues. |

---

## The Lifecycle

```
YOU (Human)
 │
 └─→ CTO Session (persistent)
      │
      ├─ Phase 0: Bootstrap the project (first time only)
      │
      │  ┌─────────────── PER TASK ───────────────┐
      │  │                                         │
      ├──┤  Plan feature (TDD-first)               │
      │  │    └─ Write dev prompt → prompts/tasks/  │
      │  │                                         │
      │  │         ↓ [You review the prompt]       │
      │  │                                         │
      │  │  Dev Agent (/dev TASK-NNN.md)           │
      │  │    ├─ Explore → Write tests → Implement │
      │  │    ├─ Self-review → Full test suite     │
      │  │    └─ Commit to main                    │
      │  │                                         │
      │  │  Code Reviewer (/code-review)           │
      │  │    ├─ Review git diff                   │
      │  │    └─ Report → code-reviews/...-R<N>.md │
      │  │                                         │
      │  │  CTO reads review:                      │
      │  │    APPROVE → next task or batch gate    │
      │  │    NEEDS CHANGES → fix → re-review      │
      │  │                                         │
      │  └─── Repeat for each task in batch ───────┘
      │
      │  ┌─────────── PER BATCH / PILLAR ─────────┐
      │  │                                         │
      ├──┤  Security Reviewer (/security-review)   │
      │  │    ├─ CTO provides commit range + tasks │
      │  │    ├─ Audit all changes in range        │
      │  │    └─ Report → security-reviews/...-R<N>│
      │  │                                         │
      │  │  CTO reads review:                      │
      │  │    CRITICAL → block, fix, re-review     │
      │  │    Clean → proceed to QA                │
      │  │                                         │
      │  │  QA Agent (/qa)                         │
      │  │    ├─ Run all tests                     │
      │  │    ├─ Code-level bug hunt               │
      │  │    ├─ Write manual test plans           │
      │  │    ├─ File GitHub issues                │
      │  │    └─ Report → qa-reports/...           │
      │  │                                         │
      │  │  CTO triages QA report                  │
      │  │    └─ Writes fix prompts (parallelizable)│
      │  │                                         │
      │  └─── Repeat for next batch ───────────────┘
      │
      └─ You review summaries. Agents do the work.
```

---

## How to Run Each Session

All agent prompts are registered as **slash commands** in `.claude/commands/`.
No pasting needed — just type the command in any Claude Code session.

| Command | Agent | Usage |
|---------|-------|-------|
| `/cto` | CTO | Start or resume the persistent planning session |
| `/dev <filename>` | Developer | Pass the task filename from `prompts/tasks/` (e.g., `/dev TASK-001-pty-engine.md`) |
| `/code-review` | Code Reviewer | Reviews latest `git diff HEAD~1` automatically |
| `/security-review` | Security Reviewer | Audits the full codebase for terminal-specific threats |
| `/qa` | QA | Runs tests, hunts bugs, writes report |

### CTO Session (Start Here)

```
1. Open Claude Code in C:\Velocity
2. Type: /cto
3. CTO will begin with Phase 0 (bootstrap) or feature planning
4. Keep this session alive across multiple features
```

### Dev Agent Session

```
1. CTO writes a task to prompts/tasks/TASK-NNN-description.md
2. YOU review the task prompt
3. Open a NEW Claude Code session in C:\Velocity
4. Type: /dev TASK-001-pty-engine.md
5. Let the agent work autonomously
6. When it commits, return to your CTO session
```

### Code Reviewer Session

```
1. Open a NEW Claude Code session in C:\Velocity
2. Type: /code-review
3. Reviewer analyzes the latest git diff
4. Report saved to: prompts/reports/code-reviews/CODE-REVIEW-<task-name>-R<N>.md
5. Go to CTO session and say: "Code review for TASK-NNN is done. Review it."
   (On re-reviews after fixes, just say: "Code review R2 for TASK-NNN is done.")
```

### Security Review Session

Runs **after code reviews pass** — may cover multiple tasks/commits.
The CTO provides the commit range and task list.

```
1. Open a NEW Claude Code session in C:\Velocity
2. Type: /security-review
3. Paste the scope the CTO gave you, e.g.:
     Commit range: abc1234..def5678
     Tasks: TASK-001, TASK-002, TASK-003
4. Reviewer audits all changes in that range
5. Report saved to: prompts/reports/security-reviews/SECURITY-REVIEW-<scope>-R<N>.md
6. Go to CTO session and say: "Security review is done. Review it."
```

**When to run:** After all code reviews for a batch are approved. At minimum,
once per MVP pillar completion.

### QA Session

```
1. Open a NEW Claude Code session in C:\Velocity
2. Type: /qa
3. QA agent runs tests, hunts for bugs, writes report
4. Report saved to: prompts/reports/qa-reports/QA-REPORT-<date>.md
5. Go to CTO session and say: "QA report is done. Review it."
```

---

## Parallelization

Once you're comfortable with the flow, you can run multiple agents simultaneously:

- **2-3 Dev Agents** working on independent features (use git worktrees if needed)
- **QA + Dev** running at the same time (QA tests previous feature while dev builds next)
- **Multiple Fix Agents** after QA finds bugs (each fixes a different issue)

The key constraint: you are the single thread. Agents are cheap and parallel.

---

## File Structure

```
C:\Velocity\
├── prompts/
│   ├── FLOW.md              ← This file (workflow reference)
│   ├── cto.md               ← CTO session prompt
│   ├── dev-agent.md         ← Dev agent template
│   ├── code-reviewer.md     ← Code reviewer template
│   ├── security-reviewer.md ← Security audit template
│   ├── qa-agent.md          ← QA agent template
│   ├── tasks/               ← CTO writes task prompts here
│   │   └── TASK-001-pty-engine.md
│   └── reports/
│       ├── code-reviews/    ← CODE-REVIEW-TASK-001-pty-engine-R1.md
│       ├── security-reviews/← SECURITY-REVIEW-TASK-001-pty-engine-R1.md
│       └── qa-reports/      ← QA-REPORT-2025-01-15.md
├── src/                     ← React/TypeScript frontend
├── src-tauri/               ← Rust/Tauri backend
└── CLAUDE.md                ← Project-level Claude Code config
```

---

## Recommended Feature Order

The CTO should implement MVP features in this order (each builds on the last):

1. **Process Interfacing (Engine)** - PTY spawning, shell management, output streaming
2. **Block Model** - Structure output into command/output blocks
3. **Decoupled Input Editor** - Rich input area with syntax highlighting
4. **Structural Layout** - Tabs and split panes
5. **Agent Mode** - AI intent classification and command translation

---

## Key Principles

1. **Fresh eyes catch bugs.** Ephemeral agents read actual code, not stale context.
2. **TDD is non-negotiable.** Tests prevent regressions and prove functionality.
3. **Security first.** This app executes system commands. Every input is untrusted.
4. **Human reviews prompts.** No agent runs without your approval.
5. **Speed through parallelism.** Multiple agents > one long session.
6. **Context is expensive.** Kill sessions early. Spawn fresh ones often.

---

## Autonomous Mode (Future)

> **Status**: Not active yet. Switch to this when the manual flow feels reliable and
> you trust the agents to execute without per-prompt approval.

### The Idea

In the manual flow, **you** are the router — you read CTO prompts, open sessions,
paste agent prompts, and shuttle reports back. This works for building trust, but
you're the bottleneck.

In autonomous mode, the **CTO becomes the router**. You talk to the CTO like a
product owner ("build feature X"), and the CTO spawns, monitors, and coordinates
all agents as subagents within a single Claude Code session. You review results,
not process.

### What Changes

| Aspect | Manual Flow | Autonomous Mode |
|--------|-------------|-----------------|
| Who spawns agents | You (separate sessions) | CTO (via `Task` tool) |
| Communication | File-based (prompts/reports/) | File-based + direct subagent returns |
| Your role | Router + reviewer | Product owner + reviewer |
| CTO permission level | Read-only + prompt files | Full orchestration (spawns subagents) |
| Prompt review | You review every prompt before agent runs | CTO runs agents directly, you review commits/reports after |
| Parallelism | Limited by your attention | CTO spawns multiple background agents |

### The Autonomous Lifecycle

```
YOU (Human)
 │
 └─→ "Build feature X" or "Fix the bugs from QA-REPORT-03-10"
      │
      CTO Session (persistent, orchestrating)
      │
      ├─ Plans feature, writes task prompt to prompts/tasks/
      │
      ├─ Spawns Dev Agent (subagent via Task tool)
      │   │  prompt: dev-agent.md + task content
      │   │  mode: "default" (can read/write/run tests)
      │   └─ Returns: commit hash, summary, any blockers
      │
      ├─ Spawns Code Reviewer (subagent, background)
      │   │  prompt: code-reviewer.md
      │   └─ Returns: review findings
      │
      ├─ IF feature touches PTY/IPC/input:
      │   Spawns Security Reviewer (subagent, background)
      │   │  prompt: security-reviewer.md
      │   └─ Returns: security report
      │
      ├─ Reviews all reports itself
      │   ├─ CRITICAL security finding? → blocks pipeline, notifies you
      │   ├─ Code review NEEDS CHANGES? → spawns fix agent
      │   └─ All clear? → proceeds to QA
      │
      ├─ Spawns QA Agent (subagent)
      │   │  prompt: qa-agent.md
      │   └─ Returns: QA report, filed issues
      │
      ├─ Triages QA results
      │   ├─ Spawns fix agents (parallel, one per independent bug)
      │   └─ Re-runs QA after fixes
      │
      ├─ Reports to you:
      │   "Feature X complete. 3 bugs found, all fixed. Security review clean.
      │    QA passed. See prompts/reports/ for details. Ready for next feature?"
      │
      └─ Awaits your next instruction
```

### How to Enable It

#### Step 1: Update CTO Prompt for Orchestration

Add this section to the CTO's prompt (or use `prompts/cto-autonomous.md` — a
variant you create when ready):

```markdown
## Orchestration Mode

You are authorized to spawn subagents directly. Do not wait for the human to
open separate sessions.

### Spawning a Dev Agent
Use the Task tool:
- subagent_type: "general-purpose"
- mode: "default"
- prompt: Concatenate the contents of prompts/dev-agent.md with the task content
- Wait for the agent to complete before proceeding

### Spawning a Code Reviewer
Use the Task tool:
- subagent_type: "general-purpose"
- mode: "default"
- prompt: Contents of prompts/code-reviewer.md
- Can run in background while you do other work

### Spawning a Security Reviewer
Use the Task tool:
- subagent_type: "general-purpose"
- mode: "default"
- prompt: Contents of prompts/security-reviewer.md
- Can run in background

### Spawning a QA Agent
Use the Task tool:
- subagent_type: "general-purpose"
- mode: "default"
- prompt: Contents of prompts/qa-agent.md
- Wait for completion before triaging

### Pipeline Rules
1. Dev Agent must complete and commit before Code Review starts
2. Code Review and Security Review can run in parallel
3. CRITICAL security findings BLOCK the pipeline — notify the human immediately
4. QA runs only after Code Review approves (or issues are fixed)
5. After QA, if bugs are found, spawn fix agents, then re-run QA
6. Report a summary to the human after each full cycle
```

#### Step 2: Permission Configuration

The CTO session needs permission to spawn subagents that can write code and run
commands. When starting the CTO session, use an appropriate permission mode.

In `.claude/settings.local.json`, ensure the CTO can:
- Read all project files
- Write to `prompts/tasks/` and `prompts/reports/`
- Spawn Task subagents
- Subagents can read/write source files and run test commands

#### Step 3: Team Mode (Optional, Advanced)

For maximum parallelism, the CTO can use Claude Code's team features:

```markdown
### Team Setup
Use TeamCreate to create a "velocity-dev" team.
Use TaskCreate to create tasks from the backlog.
Spawn named teammates:
- "dev-1", "dev-2" — Developer agents (for parallel independent features)
- "reviewer" — Code reviewer
- "security" — Security reviewer
- "qa" — QA agent

Assign tasks via TaskUpdate. Teammates work independently and report back.
Use git worktrees to give parallel dev agents isolated working copies.
```

This is the most advanced configuration — use it when you have multiple
independent features that can be built simultaneously.

### Guardrails

Autonomous doesn't mean uncontrolled. These safety nets remain:

1. **No deployment.** Agents commit to main but never push to remote without
   your explicit approval.
2. **Security is a hard gate.** CRITICAL security findings halt the pipeline
   and surface to you immediately. The CTO cannot dismiss them.
3. **Reports are always written.** Every cycle produces artifacts in
   `prompts/reports/` that you can audit at any time.
4. **CTO summarizes.** After each cycle, the CTO gives you a plain-language
   summary of what happened, what was built, what was found, and what's next.
   You decide whether to proceed.
5. **Git is the audit trail.** Every agent commits with descriptive messages.
   You can `git log` and `git diff` to verify anything the CTO claims.
6. **You can always pull the brake.** Tell the CTO "stop" or "wait" at any
   point. It pauses and awaits your input.

### Transitioning Gradually

You don't have to flip a switch. Ease into it:

| Phase | You do | CTO does |
|-------|--------|----------|
| **Manual** (current) | Open sessions, paste prompts, shuttle reports | Plans, writes prompts to files |
| **Semi-auto** | Approve prompts, CTO spawns agents | Plans, spawns agents, reports back |
| **Autonomous** | Give high-level direction, review summaries | Full pipeline: plan → dev → review → security → QA → fix → report |

**How to enter semi-auto:** Tell the CTO:
> "From now on, after I approve a task prompt, spawn the dev agent yourself
> using the Task tool. Run code review and QA yourself too. Only stop for
> my input on CRITICAL security findings or if an agent gets blocked."

**How to enter full autonomous:** Tell the CTO:
> "I trust the flow. Plan and execute features from the backlog autonomously.
> Run the full pipeline (dev → review → security → QA → fix). Report to me
> after each completed feature cycle. Stop only for CRITICAL security issues
> or blockers."
