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
Sico Experience Learning System.

Learns playbooks from trajectory data through Reflector and Curator roles,
with all model access routed through app.llmhubs.

Quick Start:
    from app.experiences import Playbook, Reflector, Curator
    from app.llmhubs.structured import HubLLMClient
    from app.experiences.roles import GeneratorOutput

    # Setup
    llm = HubLLMClient()
    playbook = Playbook()
    reflector = Reflector(llm)
    curator = Curator(llm)

    # Process trajectory data
    generator_output = GeneratorOutput(
        reasoning="Agent reasoning trace...",
        final_answer="Task result",
        bullet_ids=[]
    )

    # Learn from execution
    reflection = reflector.reflect(
        question="task description",
        generator_output=generator_output,
        playbook=playbook,
        feedback="Success/failure feedback"
    )

    curator_output = curator.curate(
        reflection=reflection,
        playbook=playbook,
        question_context="task context",
        progress="1/10 tasks completed"
    )

    playbook.apply_delta(curator_output.delta)
    playbook.save_to_file("learned_playbook.json")
"""

# --------------------------------------------------------------------------- #
# Lazy imports – only lightweight modules are loaded eagerly to avoid blocking
# on heavier runtime dependencies.
# Everything else is imported on first access via __getattr__.
# --------------------------------------------------------------------------- #

from .delta import DeltaBatch, DeltaOperation
from .playbook import Bullet, Playbook, SimilarityDecision


def __getattr__(name: str):                                  # PEP 562 lazy loader
    _lazy_map = {
        # runner (imports llm/roles chain – deferred)
        "ExperienceRunner":    (".runner", "ExperienceRunner"),
        "TrajectoryData":      (".runner", "TrajectoryData"),
        "TrajectoryStep":      (".runner", "TrajectoryStep"),
        "TrajectoryThought":   (".runner", "TrajectoryThought"),
        # llm
        "LLMClient":           (".llm", "LLMClient"),
        "HubLLMClient":        (".llm", "HubLLMClient"),
        # roles
        "Reflector":           (".roles", "Reflector"),
        "Curator":             (".roles", "Curator"),
        "ReplayGenerator":     (".roles", "ReplayGenerator"),
        "GeneratorOutput":     (".roles", "GeneratorOutput"),
        "ReflectorOutput":     (".roles", "ReflectorOutput"),
        "CuratorOutput":       (".roles", "CuratorOutput"),
        "ExtractedLearning":   (".roles", "ExtractedLearning"),
        "BulletTag":           (".roles", "BulletTag"),
        "extract_cited_bullet_ids": (".roles", "extract_cited_bullet_ids"),
        # deduplication
        "DeduplicationConfig": (".deduplication", "DeduplicationConfig"),
        "DeduplicationManager":(".deduplication", "DeduplicationManager"),
        "SimilarityDetector":  (".deduplication", "SimilarityDetector"),
        # integrations
        "wrap_playbook_context": (".integrations", "wrap_playbook_context"),
        # adapter (data format conversion)
        "convert_to_trajectory_data":  (".adapter", "convert_to_trajectory_data"),
        # service (experience learning pipeline orchestration)
        "ExperienceService":   (".service", "ExperienceService"),
        "EXPERIENCES_ENABLED":  (".service", "EXPERIENCES_ENABLED"),
        "add_playbook":        (".service", "add_playbook"),
        "read_playbook":       (".service", "read_playbook"),
        # store (playbook persistence)
        "PlaybookStore":       (".store", "PlaybookStore"),
    }
    if name in _lazy_map:
        mod_path, attr = _lazy_map[name]
        import importlib
        mod = importlib.import_module(mod_path, __name__)
        val = getattr(mod, attr)
        globals()[name] = val          # cache for next access
        return val
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "ExperienceRunner",
    "TrajectoryData",
    "TrajectoryStep",
    "TrajectoryThought",
    "LLMClient",
    "HubLLMClient",
    "Reflector",
    "Curator",
    "ReplayGenerator",
    "GeneratorOutput",
    "ReflectorOutput",
    "CuratorOutput",
    "ExtractedLearning",
    "BulletTag",
    "extract_cited_bullet_ids",
    "DeduplicationConfig",
    "DeduplicationManager",
    "SimilarityDetector",
    "wrap_playbook_context",
    "convert_to_trajectory_data",
    "ExperienceService",
    "EXPERIENCES_ENABLED",
    "add_playbook",
    "read_playbook",
    "PlaybookStore",
    "DeltaBatch",
    "DeltaOperation",
    "Bullet",
    "Playbook",
    "SimilarityDecision",
]
