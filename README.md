# SansFiction MCP & Agent Skill

Connect AI agents to [**SansFiction**](https://sansfiction.com) — a digital library for
books, collections, reading journals, and discovery.

The same capabilities are exposed two ways, both authenticated with the same bearer token:

- **MCP server** (Streamable HTTP): `https://sansfiction.com/api/mcp`
- **REST API** (v1): `https://sansfiction.com/api/v1`

## Quick start (MCP)

```bash
claude mcp add --transport http sansfiction https://sansfiction.com/api/mcp
```

Or point any MCP client at the streamable-HTTP endpoint above. Public catalog tools
need no auth; personal library tools require a bearer token (generate one at
[sansfiction.com/docs/agents](https://sansfiction.com/docs/agents)).

## Quick start (REST)

```bash
# Public catalog — no auth
curl "https://sansfiction.com/api/v1/catalog/search?q=dune&limit=5"

# Personal library — bearer token
curl -H "Authorization: Bearer $SF_TOKEN" \
  "https://sansfiction.com/api/v1/library/books?status=reading"
```

## Capabilities

**Public catalog (no auth)**

- `GET /api/v1/catalog/search?q=…&searchType=all|author|series|mood|isbn`
- `GET /api/v1/catalog/books/{bookId}`
- `GET /api/v1/catalog/series/{seriesId}`
- `GET /api/v1/catalog/collections`

**Personal library (bearer token)**

- `GET/POST /api/v1/library/books` · `PATCH/DELETE /api/v1/library/books/{bookId}`
- `GET /api/v1/library/search`
- `GET /api/v1/library/collections` · `GET /api/v1/library/collections/{id}` · `POST …/items`
- `GET /api/v1/library/stats`

## Discovery

- Agent Skill: [`SKILL.md`](./SKILL.md) — also served at
  `https://sansfiction.com/.well-known/agent-skills/sansfiction-catalog/SKILL.md`
- MCP Registry manifest: [`server.json`](./server.json)
- OpenAPI: `https://sansfiction.com/openapi.json`
- MCP server card: `https://sansfiction.com/.well-known/mcp/server-card.json`

## Authentication

Generate a personal access token (`sf_mcp_…`) while signed in at
[sansfiction.com/docs/agents](https://sansfiction.com/docs/agents). The same token
authenticates both the MCP server and the REST API. Rate limits: 60 req/min
anonymous, 180 req/min authenticated.

## License

The SansFiction service is proprietary. This repository documents its public agent
interface for discovery and integration.
