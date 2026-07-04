# Overview

> Sico: an infrastructure for symbiotic intelligence, where humans and Digital Workers co-evolve through real work.

## A natural entry point: BPO workload

In modern enterprises, BPO (Business Process Outsourcing) has become a significant component of operational productivity, and one of the earliest domains where technological shifts can produce tangible impact.
![Sico](images/history.png)
Many BPO-style workflows share several common characteristics:

- structured execution processes
- repetitive and large-scale operational workloads
- continuous human supervision and evaluation
- clearly measurable outcomes

Typical examples include [black-box testing](https://en.wikipedia.org/wiki/Black-box_testing), data processing, customer support, and content moderation.

Through long-term collaboration with BPO teams in Microsoft internal production environments, particularly in scenarios such as black-box testing, we observed that these workflows naturally generate large amounts of execution signals, operational feedback, and human evaluation data.

These characteristics make BPO workflows a natural entry point for Digital Workers.

Rather than treating execution as static automation, Sico explores Digital Workers as operational capability units that continuously improve through real execution, evaluation, and accumulated experience.

## Why Digital Worker?

In recent years, AI systems have increasingly entered everyday work scenarios, helping generate documents, analyze data, and write code. However, in real enterprise environments, most AI still remains at the stage of a tool:

- it can generate outputs, but cannot take responsibility for outcomes
- it can execute isolated steps, but cannot reliably own end-to-end operational workflows
- it can assist individuals, but cannot accumulate organizational capability over time

What enterprises require is not simply better content generation, but accountable execution that can operate continuously within real production environments.

This requires a different kind of operational unit: one that can be managed, evaluated, supervised, and continuously improved through execution.

We call this labor unit a Digital Worker.
![Sico](images/new-collaboration-paradigm.png)
The goal of Digital Workers is not to replace humans, but to establish a new production structure:

- humans define goals, provide judgment, and guide capability evolution
- Digital Workers perform scalable execution and accumulate operational experience through real work

Organizations therefore accumulate capabilities over time, rather than repeatedly solving the same operational problems from scratch.

## What a Digital Worker System Requires

Real production environments continuously evolve:

- interfaces change
- business rules evolve
- data structures update
- edge cases continuously emerge

Digital Workers are not standalone AI agents. To operate reliably in real production environments, they require a complete operational system.

A Digital Worker system must be executable, accountable and evolvable.

### 1. Scalable execution infrastructure

Reliable execution is one of the biggest barriers to enterprise AI adoption. Sico treats execution as an engineering problem rather than a prompting problem.

Sandbox-based environments provide:

- isolated runtime environments for reproducibility
- complete operation traces for replay and debugging
- execution artifacts (screenshots, logs, files) for auditability
- parallel execution across multiple devices

Execution scale becomes determined by infrastructure, not by human bandwidth.

The goal is not to simulate a person operating a computer, but to transform execution into scalable system capability.

### 2. Human-AI co-evolution

Sico does not pursue full autonomy. Human judgment remains critical in complex operational environments.

Execution must therefore remain observable, reviewable, replayable and auditable.

Digital Workers execute tasks at scale, while human Operators supervise execution quality and guide how capabilities evolve.

Operator responsibilities include:

- ensuring execution quality
- providing judgment in uncertain situations
- identifying failure patterns
- transforming operational experience into reusable capability

By making execution transparent and supervisable, Digital Workers can operate within real production responsibility structures rather than functioning as isolated AI tools.

> For a deeper discussion of the co-evolution model, see [Agentic Evolution](https://github.com/agentic-evolution/awesome-agentic-evolution/blob/main/Agentic_Evolution__From_Self_Improving_Agents_to_Co_Evolving_Human__AI_Systems.pdf).

### 3. Evolution through real execution

Conversation memory alone is insufficient for real operational environments.

What matters is remembering:

- what was done
- what failed
- how problems were resolved

Each execution produces operational signals:

- which strategies work or fail
- how environments affect outcomes
- when human intervention is required

These signals accumulate into reusable experience.

When similar situations appear again, Digital Workers can leverage historical experience to reduce repeated errors and improve execution stability.

Human supervision and operational feedback therefore become part of the evolution process itself.

Capability compounds over time through continuous execution, evaluation, and accumulated operational experience.

## Roles in Sico

To support Digital Workers operating in real production environments, Sico defines four core roles.
![Sico](images/roles.png)
### Employer

Employer defines business objectives and outcome standards for Digital Workers.

Employer responsibilities include:

- defining goals
- providing business context
- assigning work to hybrid team
- evaluating whether outcomes meet expectations

Employer focuses on business objectives and expected outcomes.

### Digital Worker

Digital Workers execute operational tasks through structured capabilities, workflows, and accumulated experience.

Different Digital Workers may specialize in different operational domains such as testing, customer support, or data processing.

A Digital Worker is not a single agent session, but a structured operational capability unit composed of multiple layers:

| Layer | Responsibility | Example |
|------|---------------|--------|
| Cortex | reasoning and decision-making | OpenAI, Anthropic, Gemini, Azure OpenAI, private models via LLM Hub |
| Action | structured execution through workflows and tools | file operations, research tools, Python execution, Android sandbox |
| Memory & Sense | operational knowledge, execution experience, and contextual awareness for grounding and continuous improvement | knowledge base, workspace memory, vector memory, execution history |

Different Digital Workers form different capability structures depending on operational roles and execution requirements.

Their capabilities are shaped not only by models, but also by workflows, execution environments, operational knowledge, and accumulated experience.

### Operator

Operators supervise execution quality and guide how capabilities evolve over time.

Operator responsibilities include:

- monitoring execution processes
- handling uncertain situations
- identifying failure patterns
- transforming operational experience into reusable capability

Operators focus on long-term capability evolution and execution reliability.

### Developer

Developers build the capability structure and infrastructure of Digital Workers.

Developer responsibilities may include:

- building workflows and tools
- designing execution environments
- integrating models and services
- developing platform infrastructure

Developers determine what Digital Workers are able to execute and how capabilities can scale.

## A concrete example: the Digital Tester

In large-scale black-box testing environments, the main challenge is often not designing test cases, but continuously executing them. Projects may accumulate thousands of test cases that must be re-executed in each release cycle. Even with automation tools, execution efficiency is constrained by:

- environment configuration complexity
- maintenance overhead
- workflow fragility

As systems evolve, scripts require continuous adjustment, and one-time automation struggles to remain stable.

In Sico, Operators can assign existing test cases to a Digital Tester, allowing it to:

- interpret test cases within project context
- execute tests across multiple Android sandboxes in parallel
- provide full execution trace and replayability
- request human judgment when encountering uncertainty

Through continuous execution, Digital Workers gradually reduce reliance on human judgment and improve adaptation to environmental changes. The result is not a one-time automation script, but an execution capability that continuously evolves with the project.

Digital Tester is only one example. The same pattern applies to other operational workflows such as:

- 3D asset generation
- marketing docs generation
- product planning

The key insight is not the task type itself, but the ability to continuously improve through real execution.

## From Tools to Workforce Infrastructure

As Digital Workers begin reliably executing operational tasks, the central question shifts from how to use AI to how to guide capability evolution.

Digital Workers introduce a different operational model: execution capability becomes persistent, reusable, and continuously improving within the organization.

Sico therefore approaches Digital Workers not as isolated agents, but as operational workforce units with lifecycle management analogous to human workforce systems.
![Sico](images/lifecycle.png)
As Digital Workers evolve through real execution, capabilities gradually become organizational assets rather than temporary task outputs.

Productivity therefore becomes driven not only by human labor, but by continuously evolving execution capability.

Sico serves as the runtime and evolution infrastructure layer for Digital Workers. It provides the operational foundation required for Developers, Employers, Operators, and Digital Workers to collaborate within real production environments.

Sico does not constrain which models, tools, or workflows must be used. Instead, it provides the infrastructure layer required for Digital Workers to operate reliably and improve continuously within real production environments.

## Reference
### Terminology quick reference
| Term | Definition |
| --- | --- |
| **Project** | A scoped workspace that carries knowledge, members, skills, and conversation history. |
| **Skill** | A packaged capability (prompts + workflows + tools) that a Digital Worker can use. See `backend/internal/embeddata/skills/`. |
| **Conversation** | A chat-style interaction binding an Operator, a Digital Worker, and a task. Streamed to clients via SSE. |
| **Knowledge** | Durable, retrievable project documents (ingested via the Knowledge service). |
| **Sandbox lease** | A time-bounded allocation of a sandbox instance to a task. |
| **LLM Hub** | The unified model runtime and registry; all Cortex traffic goes through it. |
| **Reverse gRPC** | Core -> Backend callbacks for persistence. |

### Related documentation
- [Technical Report](technical_report.md): how the system is built.
- [Quick start](quickstart.md): run Sico locally.
