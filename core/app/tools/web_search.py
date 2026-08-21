"""Azure OpenAI Responses API web_search tool definition.

This is a server-side tool — the model and API perform the web search
automatically.  No client-side handler is needed; we just declare the
tool so that the Responses API enables grounded web search for the model.
"""

# The tool spec is a plain dict (not an FunctionTool) because it uses
# the Responses API native tool type, not a function-call tool.
WEB_SEARCH_TOOL: dict[str, object] = {"type": "web_search"}
