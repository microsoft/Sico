<div align="center">

![Sico](docs/images/brand.png)

**Sico: an infrastructure for symbiotic intelligence, where humans and Digital Workers co-evolve.**

[![Discord](https://img.shields.io/badge/Discord-Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/F3tVCBHmE6)
[![Microsoft Teams](https://img.shields.io/badge/Teams-Community-6264A7)](https://teams.microsoft.com/l/team/19%3AtgoS3iJHg6-s2vhO9W5PhUtsnhqNog7yiTdcEi6sNZQ1%40thread.tacv2/conversations?groupId=720e2630-e290-40c7-9c3e-55f5ab643f32&tenantId=72f988bf-86f1-41af-91ab-2d7cd011db47)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8.svg)](backend/go.mod)
[![Python](https://img.shields.io/badge/Python-3.13+-3776AB.svg)](core/pyproject.toml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Overview](docs/overview.md) · [Quick Start](docs/quickstart.md) · [Technical Report](docs/technical_report.md) · [Agentic Evolution](docs/agentic-evolution.pdf) · [Development](docs/development.md) · [Contributing](CONTRIBUTING.md) · [Roadmap](docs/roadmap.md)

</div>

## What is Sico?

Sico — Symbiotic Intelligence for CO-evolution — is an open-source platform for building, managing, and evolving **Digital Workers**: structured AI labor units that co-evolve with human operators through real production work, particularly in BPO (Business Process Outsourcing) scenarios.

The idea behind Sico emerged from large-scale operational challenges observed in Microsoft’s internal environments, especially across BPO-style workflows such as [black-box testing](https://en.wikipedia.org/wiki/Black-box_testing).

Through real production workloads, Sico achieved closed-loop validation for Digital Workers operating under continuous execution, evaluation, and human supervision. Through this process, we observed that reliability emerged not from static automation alone, but from the continuous co-evolution between human operators and Digital Workers.

In Sico, four core roles define how work gets done:

- Employer: defines business objectives and outcome standards for Digital Workers
- Operator: responsible for training, monitoring, and improving Digital Workers
- Developer: builds the capability structure and infrastructure (workflows, tools, execution environments) of Digital Workers
- Digital Worker: executes tasks through structured capabilities and continuous learning

At the center of this system, a Digital Worker is not just a model or an agent, but a structured, executable capability unit. 

Its anatomy consists of:

- **Cortex**: reasoning and planning (LLMs, agent frameworks)
- **Action**: execution via domain skills, workflows, and sandboxed tools
- **Memory & Sense**: accumulated knowledge, execution experience and contextual awareness for grounding and continuous improvement

Human operators supervise execution quality, intervene when necessary, and guide capability improvement.
 
This creates a practical **Co-Evolution** loop where humans and Digital Workers continuously improve together through real work. 

For a comprehensive survey of this direction, refer to [**Agentic Evolution: From Self-Improving Agents to Co-Evolving Human–AI Systems** ](docs/agentic-evolution.pdf)

> Learn more: [What is Sico](docs/overview.md).

## Who is Sico for?

Sico is primarily designed for:

- BPO providers looking to build and operate AI-powered workforces for their clients
- Enterprises seeking to automate and scale operational workflows with AI
- Developers building AI workers for specific business domains

## Why Sico?
Many real-world workflows, especially in BPO scenarios such as black-box testing, data processing, customer support, and content moderation, require continuous, stable execution at scale.

BPO is a natural environment for Digital Workers:

• structured evaluation signals are continuously produced  
• feedback loops naturally exist  
• execution and supervision responsibilities can be clearly separated

Traditional automation approaches rely on static scripts or predefined workflows. However, production environments continuously change:

- interfaces evolve
- rules shift
- data formats change
- edge cases emerge

As a result, automation often becomes brittle and requires repeated manual adjustment.

Digital Workers approach this problem differently. Instead of treating execution as a fixed process, Sico treats execution as an evolving capability.

As Digital Workers take on execution, human roles shift from doing tasks to guiding evolution through the Operator role.

Each completed task contributes signals that help Digital Workers adapt to real environments, enabling organizations to scale execution capacity while continuously increasing reliability.


| Pain point | Sico's approach |
| --- | --- |
| Agents are thin wrappers around a model and a toolbox | A structured **Cortex / Action / Memory** architecture with project-level knowledge |
| AI repeats the same mistakes task after task | **Execution experience** captured as training signals for continuous improvement |
| Full autonomy is unreliable; humans can't easily intervene | The **Operator** role: human-in-the-loop collaboration with clear responsibility boundaries |
| GUI automation is flaky and hard to reproduce | **Sandbox** execution with isolated environments, step-level traces, and replayable runs |

## Architecture at a glance

![Sico architecture](docs/images/architecture.png)

```
Frontend (React) ──HTTP/SSE──▶ Nginx ──▶ Backend (Go / Gin)
                                            │         ▲
                                     gRPC   │         │  reverse gRPC
                                            ▼         │
                                         Core (Python / asyncio)
```

- **Backend**: HTTP APIs, persistence, RBAC, sandbox orchestration.
- **Core**: agent reasoning, tool execution, LLM orchestration, experience accumulation.
- **Reverse gRPC**: Core calls back into the Backend to persist messages, update state, and send notifications, so the Core remains database-free.

On top of this runtime, Sico organizes work into **three loops** that together form the co-evolution cycle between Operators and Digital Workers:

- **Execution Loop**: turns an Operator goal into a traced agent run. The Cortex–Action–Memory stack executes inside an observable Sandbox and emits structured trajectories: actions, intermediate states, tool outputs, and environmental feedback.
- **Evolution Loop**: converts those trajectories into reusable capability. A Reflector → Curator pipeline distills successful strategies and recurring failure patterns into a per-(project, agent) **Playbook** that is injected into the next run's workspace (training-free), while the same signals can also be fed back into base-model training (training-based).
- **Evaluation Loop** *(planned)*: analyzes failed task trajectories and attributes the root cause using an L1–L4 failure taxonomy, from high-level ownership to concrete failure mode. The results help the Operator provide targeted corrections and feed failure insights back into Experience Learning and future training.

## Features

- **Multi-service platform**: Go backend, Python core, React frontend, communicating over gRPC and a bidirectional *reverse gRPC* pattern.
- **LLM Hub**: unified model runtime with adapters for OpenAI, Azure OpenAI, Anthropic, Gemini, OpenRouter, OpenAI-compatible providers, and generic HTTP JSON / binary endpoints. See [LLM Hub docs](backend/docs/llmhub.md).
- **Agent toolkit**: file I/O, grep, shell/command execution, web search & fetch, document parsing, long-term memory retrieval, agent-side plan inspection / cancellation, reporting, and sandbox tools out of the box.
- **Sandbox system**: pooled, leased Android emulator sandboxes with H264 live view, VNC, and full operation traces.
- **Memory & knowledge**: short-term turn context, long-term facts via Mem0 + Qdrant, durable knowledge bases, and project-scoped memory, backed by SeaweedFS, Redis and MySQL.
- **Skills**: register, version, and execute reusable Digital Worker skills as first-class platform objects, composed from the Cortex, Action, and Memory layers above.
- **Experience Learning**: a Reflector then Curator pipeline distills successful strategies and recurring failure patterns from completed tasks into a per-(project, agent) **Playbook**, automatically injected into the next run, so Digital Workers improve from real work without retraining the model.
- **RBAC & security**: JWT + Casbin for human users; HMAC-signed requests for sandbox machine-to-machine traffic.
- **Deployable everywhere**: Docker Compose for local dev, Kind + Helm for local Kubernetes, Helm charts for production.

> Deep dive: [Sico Technical Report](docs/technical_report.md)

## Quick Start

### Prerequisites

- Docker & Docker Compose
- `make`
- A valid API key for at least one LLM provider (OpenAI / Azure OpenAI / Anthropic / Gemini / OpenRouter)

### Prepare the configuration (shared by all run modes)

```bash
git clone https://github.com/microsoft/Sico.git
cd Sico
cp .env.example .env            # edit values as needed
```

Before starting the stack, configure at least one LLM model. Create a YAML file under
`deploy/config/llmhubs/<your-model>.yaml` (use [`deploy/config/llmhubs/model-template.yaml`](deploy/config/llmhubs/model-template.yaml)
or one of the `*-template.yaml` files as a starting point) and make sure it contains:

```yaml
default: true                   # mark this model as the default for the platform
```

Next, configure Mem0:

```bash
cp deploy/config/mem0/mem0_config_template.yaml deploy/config/mem0/mem0_config.yaml
# then edit deploy/config/mem0/mem0_config.yaml to fill in embedder / llm credentials
```

If you plan to collaborate with the Android Tester, you will need the Android emulator sandbox. 

Install [MuMu Player](https://www.mumuplayer.com/) and set up the emulator API service before bringing up the stack:

```bash
# Install prerequisites and start the API service.
make emulator-setup

# Verify the API service is running.
make emulator-status

# Bootstrap the default emulator device.
make emulator-bootstrap
```

> Required only for Android Tester. See [sandbox/emulator/setup/README.md](sandbox/emulator/setup/README.md) for detailed prerequisites.

Then pick **one** of the run modes below.

### Run mode A: Docker Compose (recommended for local dev)

```bash
make compose-up                 # builds and starts nginx, frontend, backend, core, mysql, redis, kafka, seaweedfs, qdrant
```

Then verify the stack:

- UI login: [http://localhost:8080/login](http://localhost:8080/login)
- API docs: [http://localhost:8080/api/sico/docs/index.html](http://localhost:8080/api/sico/docs/index.html)
- Health: `curl http://localhost:8080/api/sico/health`

Sign in with the seeded default account (local development only — rotate or remove before exposing the stack outside your machine):

- **Username**: `operator@sico.local`
- **Password**: `operator`

### Run mode B: Kubernetes (Kind)

Alternative to Docker Compose — runs the same stack on a local Kind cluster via Helm. Prerequisites (`.env`, LLM config, Mem0 config, optional emulator) are identical; just replace `make compose-up` with `make kind-up`:

```bash
make kind-up                    # create Kind cluster, build images, deploy via Helm
make kind-restart SVC=core      # rebuild and roll out one app service
make kind-stop                  # stop Kind containers without deleting data
make kind-down                  # tear down and delete local cluster data
```

> Full guide: [Quick start](docs/quickstart.md) · Hit an issue? See [Troubleshooting](docs/quickstart.md#troubleshooting)

## Repository layout

```
sico/
├── backend/              # Go HTTP + gRPC service (Gin, GORM, Wire)
├── core/                 # Python agent orchestration service (asyncio, grpclib)
├── proto/                # Protobuf definitions shared by all services
├── sandbox/              # Sandbox runtimes (Android emulator, ...)
├── examples/             # Runnable workflow examples (auth, LLM Hub, conversation, sandbox, ...)
├── deploy/
│   ├── docker/           # docker-compose stack
│   └── kind/             # Kind + Helm setup
├── docs/                 # Documentation
└── scripts/              # Dev-tool installers, lint scripts
```

## Documentation

| Topic | Link |
| --- | --- |
| What Sico is and why it exists | [docs/overview.md](docs/overview.md) |
| Quick start & deployment | [docs/quickstart.md](docs/quickstart.md) |
| System architecture, Experience Learning, and full design | [docs/technical_report.md](docs/technical_report.md) |
| Development workflow (build, test, protobuf, DI) | [docs/development.md](docs/development.md) |
| Roadmap & vision | [docs/roadmap.md](docs/roadmap.md) |
| LLM Hub API & provider adapters | [backend/docs/llmhub.md](backend/docs/llmhub.md) |
| Android emulator sandbox setup | [sandbox/emulator/setup/README.md](sandbox/emulator/setup/README.md) |

## Contributing

Contributions of all kinds are welcome: bug reports, feature ideas, documentation, and code.

- Start with [CONTRIBUTING.md](CONTRIBUTING.md) for contribution rules and PR expectations.
- See [docs/development.md](docs/development.md) for local setup, build commands, code generation, and troubleshooting.
- Install the default toolchain with one command: `make setup`.
- Please read our [Code of Conduct](CODE_OF_CONDUCT.md).
- For security issues, see [SECURITY.md](SECURITY.md); please don't file public issues for vulnerabilities.

## License

Sico is licensed under the [MIT License](LICENSE).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft’s Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party’s policies.

## Acknowledgements

Sico stands on the shoulders of the open-source community: Go, Gin, GORM, Wire, Python, asyncio, grpclib, betterproto, React, Vite, and many more.
Some example skills included in this repository are adapted from the [RefoundAI lenny-skills](https://github.com/RefoundAI/lenny-skills) project.

We are grateful to the maintainers, contributors, and the broader open-source community whose work makes Sico possible.
Thank you to everyone who has [contributed](https://github.com/microsoft/Sico/graphs/contributors) to Sico.
