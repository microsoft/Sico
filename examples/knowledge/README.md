# Knowledge Examples

These examples show how project knowledge is registered through the HTTP API.

## Scripts

- `python3 -m examples.knowledge.create_link_document`
- `python3 -m examples.knowledge.upload_file_document`

## Environment

- `TOKEN`: required
- `PROJECT_ID`: defaults to `1`, matching the seeded default project
- `AGENT_ID`: optional; attach the knowledge document to a specific agent
- `DOC_URL`: optional; used by `create_link_document`
- `FILE_PATH`: optional; defaults to repo-root `README.md` for `upload_file_document`

`upload_file_document` first uploads the file as a project asset, then creates a
knowledge document referencing the returned `assetId`.