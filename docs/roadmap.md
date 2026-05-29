# Roadmap

Sico is at an early, actively-evolving stage. This roadmap captures our direction, not a commitment to specific dates. Priorities shift based on user feedback and real-world deployment experience.

We track concrete work items as [GitHub Issues](https://github.com/microsoft/Sico/issues). This page is the higher-level view.

## Current scope

What is shipping today:

- **Operator Console**: the primary Sico interface for running, supervising and observing Digital Workers.
- **Developer Interface**: allowing developers to configure and deploy Digital Workers without a dedicated frontend builder UI.
- **Digital Workers**: multiple built-in Digital Worker roles, including Android Tester, Product Manager, Marketing and 3D Artist.
- **Android Sandbox**: emulator-based execution environment with H264 live view, VNC, and full traces.
- **Project & Knowledge**: project workspaces with durable knowledge bases.
- **LLM Hub**: unified model runtime; supports OpenAI, Azure OpenAI, Anthropic, Gemini, OpenRouter, and any OpenAI-compatible endpoint.
- **Experience Learning (v1)**: first iteration of execution experience capture for the Evolution loop.
- **RBAC & auth**: JWT + Casbin for users; HMAC for sandbox machine-to-machine.

Frontend source code is not currently published in this repository. For now, the frontend is provided separately as a packaged archive while the backend, core, sandbox, proto, deployment, examples, and documentation remain in the public repo.


## Near-Term Direction

- **More Digital Workers & Richer Capability Structures**: expand Digital Worker roles and role-specific capabilities to further demonstrate the capability-unit architecture rather than building a generic agent marketplace. The focus is not the number of roles, but how different Cortex, Action, and Memory&Sense structures support different forms of work execution.
- **Broader Execution Environments**: expand beyond Android into additional sandbox runtimes, including Web Sandbox and Windows Sandbox.
- **Frontend Release Path**: continue improving the packaged frontend distribution model while preparing a future path for frontend source publication when ready.
- **Documentation**: expanded guides for authoring skills, onboarding models, configuring Digital Workers, and extending the sandbox layer.

## Longer-Term Direction

- **Richer Co-Evolution Mechanisms**: move beyond experience-as-prompt approaches toward structured workflow adaptation and skill evolution mechanisms.
- **Agent Evaluation Framework**: a standardized framework for measuring Digital Worker reliability and improvement over time. The goal is forming a closed Evaluation → Evolution loop for Digital Workers.
- **Deeper Operator Tooling**: continue evolving the Operator experience for large-scale Digital Worker operations, including: review systems and long-term capability governance.

## Out of scope (today)

- Hosted / SaaS offering of Sico.
- Employer / end-user interfaces (Teams mini app, embedded surfaces).
- Opinionated model weights: Sico stays model-agnostic; it integrates with providers rather than shipping models.

## Contributing ideas

Have a use case, a proposal, or an existing tool you think should integrate with Sico? Open a [discussion](https://github.com/microsoft/Sico/discussions) or [issue](https://github.com/microsoft/Sico/issues). Real workload feedback is the single most valuable input for the roadmap.
