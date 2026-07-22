Your previous generation attempt partially completed before encountering an error. The messages that follow show the assistant output and tool calls that were already produced and executed during that failed attempt.

**Important rules for this retry:**
- Do NOT re-execute tool calls that already succeeded — their side effects (file writes, plan updates, database changes) have already taken effect.
- Continue from where the previous attempt left off.
- If the previous attempt's output already addressed the user's request, you may simply wrap up with a brief summary.
