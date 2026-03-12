# Velocity Development Flow

> **Init Session**: `e3d2bce7-a88c-456f-b6d4-bd7e3684bdb5`

## Overview

Multi-agent development workflow for **Velocity**, a modern Windows terminal built with Tauri + React/TypeScript. Inspired by the [SLAWK methodology](https://ncvgl.github.io/posts/slawk/).

The core idea: a persistent CTO session plans and orchestrates, ephemeral agents execute as subagents, and the human acts as the product owner. You say "next task" — the CTO runs the full pipeline.

---

## Agent Roles

| Agent | Session | Lifespan | Purpose |
|-------|---------|----------|---------|
| **CTO** | Persistent | Days | Plans features, orchestrates pipeline, reviews reports, triages bugs. Never writes code. Spawns all other agents. |
| **Developer** | Subagent | 1 feature | Explores codebase, writes tests, implements, commits. Fresh context every time. |
| **Code Reviewer** | Subagent | 1 review | Reviews git diff for quality, patterns, and correctness. |
| **Security Reviewer** | Subagent | 1 review | Dedicated security audit — command injection, IPC attack surface, escape sequence exploits. |
| **QA** | Subagent | 1 cycle | Runs tests, analyzes code for bugs, writes manual test plans, files issues. |

---

## The Lifecycle (Autonomous)

```
YOU: "Next task" or "Build feature X"
 │
 └─→ CTO Session (persistent, orchestrating)
      │
      ├─ Phase 0: Bootstrap the project (first time only)
      │
      │  ┌─────────────── PER TASK ───────────────┐
      │  │                                         │
      ├──┤  1. Plan (TDD-first)                    │
      │  │     └─ Write task → prompts/tasks/      │
      │  │                                         │
      │  │  2. Spawn Dev Agent (Task tool)         │
      │  │     ├─ Explore → Tests → Implement      │
      │  │     └─ Commit to main                   │
      │  │                                         │
      │  │  3. Spawn Code Reviewer (Task tool)     │
      │  │     └─ Report → code-reviews/...-R<N>   │
      │  │                                         │
      │  │  4. CTO reads review:                   │
      │  │     APPROVE → next task or batch gate   │
      │  │     NEEDS CHANGES → spawn fix → re-review│
      │  │                                         │
      │  └─── Repeat for each task in batch ───────┘
      │
      │  ┌─────────── PER BATCH / PILLAR ─────────┐
      │  │                                         │
      ├──┤  5. Spawn Security Reviewer (Task tool) │
      │  │     ├─ CTO provides commit range + tasks│
      │  │     └─ Report → security-reviews/...-R<N>│
      │  │                                         │
      │  │  6. CTO reads security report:          │
      │  │     CRITICAL → STOP, notify human       │
      │  │     Clean → proceed to QA               │
      │  │                                         │
      │  │  7. Spawn QA Agent (Task tool)          │
      │  │     └─ Report → qa-reports/...          │
      │  │                                         │
      │  │  8. CTO triages QA:                     │
      │  │     Bugs → spawn fix agents → re-QA     │
      │  │     Clean → done                        │
      │  │                                         │
      │  └─────────────────────────────────────────┘
      │
      ├─ Report summary to human
      └─ Await next instruction
```

---

## How to Use

### Starting the CTO

```
1. Open Claude Code in C:\Velocity
2. Type: /cto
3. CTO will begin with Phase 0 (bootstrap) or feature planning
4. Keep this session alive across multiple features
```

### Running the Pipeline

Once the CTO is running, just tell it what to do:

```
"Next task"                          → CTO picks next from backlog, runs full pipeline
"Build the PTY engine"               → CTO plans and executes that feature
"Fix the bugs from the QA report"    → CTO reads report, spawns fix agents
```

The CTO spawns all agents itself via the **Task tool** — you don't open
separate sessions. You review the summary when it's done.

### Human Touchpoints

You only need to intervene for:

1. **Giving direction** — "next task", "build X", "fix Y"
2. **CRITICAL security findings** — CTO halts and notifies you
3. **Blocked agents** — CTO escalates if an agent can't make progress
4. **Reviewing summaries** — CTO reports after each completed cycle

Everything else is automated.

### Slash Commands (Still Available)

The slash commands still work if you want to run an agent manually:

| Command | Agent | Usage |
|---------|-------|-------|
| `/cto` | CTO | Start the persistent session |
| `/dev <filename>` | Developer | Manual: `/dev TASK-001-pty-engine.md` |
| `/code-review` | Code Reviewer | Manual: reviews latest git diff |
| `/security-review` | Security Reviewer | Manual: audits codebase |
| `/qa` | QA | Manual: runs tests and hunts bugs |

---

## Guardrails

Autonomous doesn't mean uncontrolled:

1. **No remote push.** Agents commit to main but never push without your approval.
2. **Security is a hard gate.** CRITICAL findings halt the pipeline and notify you. The CTO cannot dismiss them.
3. **Reports are always written.** Every cycle produces artifacts in `prompts/reports/` you can audit anytime.
4. **CTO summarizes.** After each cycle: what was built, what was found, what was fixed, what's next.
5. **Git is the audit trail.** Every agent commits with descriptive messages.
6. **You can always say "stop".** CTO pauses and awaits your input.

---

## File Structure

```
C:\Velocity\
├── .claude/
│   └── commands/            ← Slash commands (mirrors prompts/)
├── prompts/
│   ├── FLOW.md              ← This file (workflow reference)
│   ├── STATE.md             ← Project state (CTO reads on start, updates after each cycle)
│   ├── cto.md               ← CTO session prompt
│   ├── dev-agent.md         ← Dev agent template
│   ├── code-reviewer.md     ← Code reviewer template
│   ├── security-reviewer.md ← Security audit template
│   ├── qa-agent.md          ← QA agent template
│   ├── tasks/               ← CTO writes task prompts here
│   │   └── TASK-001-pty-engine.md
│   └── reports/
│       ├── code-reviews/    ← CODE-REVIEW-TASK-001-pty-engine-R1.md
│       ├── security-reviews/← SECURITY-REVIEW-PILLAR-1-process-engine-R1.md
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
4. **CTO orchestrates.** The CTO spawns and manages all agents autonomously.
5. **Speed through parallelism.** Multiple agents > one long session.
6. **Context is expensive.** Kill sessions early. Spawn fresh ones often.

---

## Manual Mode (Fallback)

If you want to take back control and run agents yourself (e.g., the autonomous
flow isn't working well, or you want to review each step), tell the CTO:

> "Switch to manual mode. Write prompts to files and I'll run agents myself."

In manual mode:

| Step | You do |
|------|--------|
| Dev | Open new session, type `/dev TASK-NNN.md` |
| Code Review | Open new session, type `/code-review` |
| Security Review | Open new session, type `/security-review`, paste scope from CTO |
| QA | Open new session, type `/qa` |
| Report back | Tell CTO: "Code review for TASK-NNN is done. Review it." |

The CTO reverts to writing prompts to `prompts/tasks/` and waiting for you
to report results. All the same file conventions and report formats apply.

To switch back to autonomous: tell the CTO "resume autonomous mode."
