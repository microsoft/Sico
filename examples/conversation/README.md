# Conversation Examples

This group demonstrates the streaming chat path exposed by
`POST /api/sico/conversation/chat`.

## Scripts

- `python3 -m examples.conversation.chat_stream`

## Environment

- `TOKEN`: required
- `BASE_URL`: defaults to `http://localhost:8080`
- `AGENT_INSTANCE_ID`: defaults to `1`, matching the seeded chat agent instance
- `CHAT_MESSAGE`: optional prompt text

The script prints each SSE event as it arrives so you can inspect the event
stream shape outside the frontend.