# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

"""
Base classes and utilities for experience learning integrations with external agentic frameworks.

This module provides the foundation for integrating experience learning capabilities
with external agentic systems like browser-use, LangChain, CrewAI, and custom agents.

## When to Use Integrations vs Full Experience Learning Pipeline

### Use INTEGRATIONS (this module) when:
- You have an existing agentic system (browser-use, LangChain, custom agent)
- The external agent handles task execution
- You want the experience system to learn from that agent's results
- Example: Browser automation, LangChain chains, API-based agents

### Use FULL EXPERIENCE LEARNING PIPELINE when:
- Building a new agent from scratch
- Want the Generator to handle task execution
- Simple Q&A, classification, reasoning tasks
- Example: Question answering, data extraction, summarization

## Integration Pattern (Three Steps)

The integration pattern allows external agents to benefit from experience learning
without replacing their execution logic:

    1. INJECT: Add playbook context to agent's input (optional)
       → wrap_playbook_context(playbook) formats learned strategies

    2. EXECUTE: External agent runs normally
       → Your framework handles the task (browser-use, LangChain, etc.)

    3. LEARN: The experience system analyzes results and updates playbook
       → Reflector: Analyzes what worked/failed
       → Curator: Updates playbook with new strategies

## Basic Example

```python
from app.experiences.integrations import wrap_playbook_context
from app.experiences import Playbook, Reflector, Curator, HubLLMClient
from app.experiences.roles import GeneratorOutput

# Setup
playbook = Playbook()
llm = HubLLMClient()
reflector = Reflector(llm)
curator = Curator(llm)

# 1. INJECT: Add learned strategies to task (optional)
task = "Process user request"
if playbook.bullets():
    task_with_context = f"{task}\\n\\n{wrap_playbook_context(playbook)}"
else:
    task_with_context = task

# 2. EXECUTE: Your agent runs
result = your_agent.execute(task_with_context)

# 3. LEARN: The experience system learns from results
generator_output = GeneratorOutput(
    reasoning=f"Task: {task}",
    final_answer=result.output,
    bullet_ids=[],  # External agents don't cite bullets
    raw={"success": result.success}
)

reflection = reflector.reflect(
    question=task,
    generator_output=generator_output,
    playbook=playbook,
    feedback=f"Task {'succeeded' if result.success else 'failed'}"
)

curator_output = curator.curate(
    reflection=reflection,
    playbook=playbook,
    question_context=f"task: {task}",
    progress=f"Executing: {task}"
)

playbook.apply_delta(curator_output.delta)
playbook.save_to_file("learned.json")
```
"""

from ..playbook import Playbook
from ..prompts import wrap_playbook_for_external_agent


def wrap_playbook_context(playbook: Playbook) -> str:
    """
    Wrap playbook bullets with explanation for external agents.

    This helper formats learned strategies from the playbook with instructions
    on how to apply them. Delegates to the canonical implementation in
    prompts module to ensure consistency across all experience learning components.

    The formatted output includes:
    - Header explaining these are learned strategies
    - List of bullets with success rates (helpful/harmful scores)
    - Usage instructions on how to apply strategies
    - Reminder that these are patterns, not rigid rules

    Args:
        playbook: Playbook with learned strategies

    Returns:
        Formatted text explaining playbook and listing strategies.
        Returns empty string if playbook has no bullets.

    Examples:
        Basic usage with any agent:
        >>> playbook = Playbook()
        >>> playbook.add_bullet("general", "Always verify inputs")
        >>> context = wrap_playbook_context(playbook)
        >>> enhanced_task = f"{task}\\n\\n{context}"
        >>> result = your_agent.execute(enhanced_task)

        Conditional injection (skip if empty):
        >>> if playbook.bullets():
        >>>     task = f"{task}\\n\\n{wrap_playbook_context(playbook)}"
        >>> # task unchanged if no learned strategies yet

    Integration Patterns:
        1. String Concatenation (most common):
           enhanced_task = f"{task}\\n\\n{context}"

        2. Dict/Kwargs Injection:
           chain.run(input=task, learned_strategies=context)

        3. System Message Injection:
           messages = [
               {"role": "system", "content": context},
               {"role": "user", "content": task}
           ]

        4. Tool Description Enhancement:
           tool.description += f"\\n\\nLearned patterns: {context}"
    """
    return wrap_playbook_for_external_agent(playbook)


__all__ = ["wrap_playbook_context"]
