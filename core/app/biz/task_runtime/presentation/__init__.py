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

"""Presentation-layer adapters for task_runtime: plan mirroring and rendering.

This package is the impure boundary that may import ``app.schemas`` and write
to the chat ``PlanEditor``. The runtime **lifecycle** modules (scheduler,
coordinators, result finalizer) depend only on the neutral seam
(:mod:`..progress_port` / :mod:`..progress_events`) and the concrete sink is
wired in at the composition root (:mod:`..manager`). The **plan-creation /
recovery** modules (:mod:`..submitter`, :mod:`..stale_reconciler`) still import
rendering helpers directly, since building the initial plan / recovery messages
is itself schema-coupled work; tightening that edge is deferred future work.
"""
