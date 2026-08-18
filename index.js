#!/usr/bin/env node
/**
 * SansFiction MCP server (stdio).
 *
 * A thin, runnable MCP server for the SansFiction books catalog + personal
 * reading library. Tool definitions are local (so `tools/list` works with no
 * network/credentials); tool *calls* proxy to the public REST API at
 * https://sansfiction.com/api/v1.
 *
 * Env:
 *   SANSFICTION_BASE_URL  (default: https://sansfiction.com)
 *   SANSFICTION_TOKEN     bearer token (sf_mcp_...) required only for library tools
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE = (process.env.SANSFICTION_BASE_URL || "https://sansfiction.com").replace(/\/+$/, "");
const TOKEN = process.env.SANSFICTION_TOKEN || "";

// Annotation presets (MCP tool hints).
const READ = { readOnlyHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, openWorldHint: true };

const PUBLIC_TOOLS = [
  {
    name: "search_books",
    description:
      "Search the public SansFiction catalog (no auth). Returns JSON " +
      "{ query, searchType, count, books[] }; each book includes `id` (the catalog UUID " +
      "used as `book_id` by every other tool), `slug`, `title`, and `authors`. " +
      "When to use: your entry point for discovery — resolve a title/author/ISBN into a book_id. " +
      "Use search_my_library instead to search only the signed-in user's own shelves; use " +
      "get_book once you already have an id/slug and want full details.",
    annotations: { title: "Search catalog", ...READ },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description:
            "Search text. With searchType 'isbn' (or an 'isbn:' prefix) pass a 10- or 13-digit ISBN.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum number of books to return. Range 1–50. Default 20.",
        },
        searchType: {
          type: "string",
          enum: ["all", "author", "series", "mood", "isbn"],
          description:
            "What `query` matches against. 'all' (default) = title/general full-text; " +
            "'author' = contributor name; 'series' = series name; 'mood' = a mood term " +
            "such as cozy or dark; 'isbn' = exact ISBN-10/13 lookup.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_book",
    description:
      "Get full public metadata for a single book by catalog UUID or slug. Returns { book } " +
      "(title, authors, description, editions, series, identifiers). Returns a 404 error if not found. " +
      "When to use: you already have a book_id or slug and need details/editions. If you only have " +
      "a title or author, call search_books first to obtain the id.",
    annotations: { title: "Get book details", ...READ },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        book_id: {
          type: "string",
          description: "Catalog book UUID or slug, as returned in `id`/`slug` by search_books.",
        },
        edition_id: {
          type: "string",
          description:
            "Optional edition UUID to resolve a specific edition (language, cover, ISBN) " +
            "instead of the default/primary edition.",
        },
      },
      required: ["book_id"],
    },
  },
  {
    name: "get_series",
    description:
      "Get a book series and its ordered volumes by series UUID. Returns { series } including the " +
      "volume list with positions. Returns a 404 error if the series is unknown. " +
      "When to use: to enumerate every volume in a series and their reading order. Obtain series_id " +
      "from a book's `series` metadata via get_book or search_books — this tool does not accept a name.",
    annotations: { title: "Get series details", ...READ },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        series_id: {
          type: "string",
          description: "Series UUID, found in a book's `series` metadata from get_book/search_books.",
        },
      },
      required: ["series_id"],
    },
  },
  {
    name: "list_public_collections",
    description:
      "List public, curated collections (no auth). Returns { count, collections[] } with " +
      "id, name, and description. Page through results with limit + offset. " +
      "When to use: browse editorially curated public collections available to everyone. For the " +
      "signed-in user's OWN collections, use list_my_collections instead.",
    annotations: { title: "List public collections", ...READ },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          description: "Maximum collections to return. Default 20.",
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: "Number of collections to skip, for pagination. Default 0.",
        },
      },
    },
  },
];

const AUTH_NOTE = " Requires SANSFICTION_TOKEN (a bearer token from https://sansfiction.com/docs/agents).";

const LIBRARY_TOOLS = [
  {
    name: "list_my_books",
    description:
      "List books on the authenticated user's shelves, most-recently-updated first. Returns " +
      "{ count, books[] } where each entry has status, current_page, percent, rating, and book " +
      "metadata. When to use: browse or enumerate the user's library, optionally filtered by shelf. " +
      "To find a specific title within the library use search_my_library; for the public catalog use " +
      "search_books." + AUTH_NOTE,
    annotations: { title: "List my library", ...READ },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          enum: ["reading", "want", "read", "dnf", "all"],
          description:
            "Shelf filter: 'reading' = in progress, 'want' = to-read, 'read' = finished, " +
            "'dnf' = did not finish, 'all' = every shelf. Default 'all'.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          description: "Maximum books to return. Default 20.",
        },
      },
    },
  },
  {
    name: "add_book_to_library",
    description:
      "Add a catalog book to the user's library. Idempotent upsert — calling again with a different " +
      "status moves the book to that shelf rather than erroring. When to use: put a catalog book " +
      "(book_id from search_books) onto a shelf for the first time. To edit an existing entry's " +
      "status/rating/review/progress use update_library_book; to take a book off entirely use " +
      "remove_book_from_library." + AUTH_NOTE,
    annotations: { title: "Add book to library", ...WRITE, idempotentHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        book_id: {
          type: "string",
          description: "Catalog book UUID (the `id` from search_books).",
        },
        status: {
          type: "string",
          enum: ["reading", "want", "read", "dnf"],
          description: "Shelf to place the book on. Default 'want' (to-read).",
        },
        edition_id: {
          type: "string",
          description: "Optional specific edition UUID to associate with this library entry.",
        },
      },
      required: ["book_id"],
    },
  },
  {
    name: "update_library_book",
    description:
      "Update one or more fields of a book already in the library. Supply any subset — only the " +
      "fields you pass change. Special behavior: `current_page` records a reading-progress log " +
      "entry (this is what feeds get_reading_stats), and setting `rating` or `review` publishes " +
      "that entry publicly. Returns the updated row; errors with 404 if the book is not in the " +
      "library (add it first). When to use: change fields or log progress for a book ALREADY on a " +
      "shelf. Add it first with add_book_to_library; remove it with remove_book_from_library." +
      AUTH_NOTE,
    annotations: { title: "Update library book", ...WRITE, destructiveHint: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        book_id: {
          type: "string",
          description: "Catalog book UUID of a book already on one of your shelves.",
        },
        status: {
          type: "string",
          enum: ["reading", "want", "read", "dnf"],
          description: "Move the book to this shelf.",
        },
        rating: {
          type: "number",
          minimum: 0,
          maximum: 5,
          description: "Your rating on a 0–5 scale. Setting it publishes the entry.",
        },
        review: {
          type: "string",
          description: "Free-text review. Setting it publishes the entry.",
        },
        started_at: {
          type: "string",
          description: "Date you started reading, ISO 8601 date (YYYY-MM-DD).",
        },
        finished_at: {
          type: "string",
          description: "Date you finished reading, ISO 8601 date (YYYY-MM-DD).",
        },
        current_page: {
          type: "integer",
          minimum: 0,
          description:
            "Current page number. Passing this appends a reading-progress log entry used by " +
            "get_reading_stats; it does not merely overwrite a field.",
        },
      },
      required: ["book_id"],
    },
  },
  {
    name: "remove_book_from_library",
    description:
      "Remove a book from the user's library entirely (all shelves). Idempotent — removing a book " +
      "that is not present is a no-op. When to use: permanently take a book out of the library. If " +
      "you only want to change its shelf (e.g. mark 'dnf' or 'read'), use update_library_book " +
      "instead — do not remove and re-add." + AUTH_NOTE,
    annotations: { title: "Remove book from library", ...WRITE, idempotentHint: true, destructiveHint: true },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        book_id: {
          type: "string",
          description: "Catalog book UUID to remove from your library.",
        },
      },
      required: ["book_id"],
    },
  },
  {
    name: "search_my_library",
    description:
      "Full-text search restricted to the user's own library (matches book title and subtitle). " +
      "Returns { count, books[] } with status and rating. When to use: find a specific book the user " +
      "already owns. For catalog-wide discovery use search_books; to list everything on the shelves " +
      "(optionally by status) use list_my_books." + AUTH_NOTE,
    annotations: { title: "Search my library", ...READ },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "Text matched (case-insensitive) against titles/subtitles of books you own.",
        },
        status: {
          type: "string",
          enum: ["reading", "want", "read", "dnf", "all"],
          description: "Restrict to one shelf. Default 'all'.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          description: "Maximum results to return. Default 10.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_my_collections",
    description:
      "List the user's own collections. Returns { count, collections[] } (id, name, description, " +
      "visibility). When to use: the signed-in user's OWN collections. For editorially curated " +
      "public collections available to everyone, use list_public_collections instead." + AUTH_NOTE,
    annotations: { title: "List my collections", ...READ },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          description: "Maximum collections to return. Default 20.",
        },
        query: {
          type: "string",
          description: "Optional case-insensitive filter on collection name.",
        },
      },
    },
  },
  {
    name: "get_reading_stats",
    description:
      "Reading statistics for a time range, matching the app's Stats page. Choose the range in ONE " +
      "of two ways: (a) `scope` + `date` — e.g. scope='monthly', date='2026-03-15' covers that " +
      "whole month; or (b) an explicit `from`+`to` pair, which OVERRIDES scope/date when both are " +
      "given. Returns { range:{start,end}, booksFinishedCount, totalPagesRead, dailyAverage, " +
      "logsCount, logs? }. `dailyAverage` is computed only for monthly/yearly scopes (null for " +
      "weekly and for explicit from/to ranges). When to use: aggregate metrics (pages read, books " +
      "finished, averages) over a period. To list the underlying books use list_my_books; to record " +
      "progress that feeds these numbers use update_library_book with current_page." + AUTH_NOTE,
    annotations: { title: "Get reading stats", ...READ },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        scope: {
          type: "string",
          enum: ["weekly", "monthly", "yearly"],
          description:
            "Granularity of the range relative to `date`. Default 'monthly'. Ignored when both " +
            "`from` and `to` are supplied.",
        },
        date: {
          type: "string",
          description:
            "Anchor date (ISO 8601 YYYY-MM-DD) selecting which week/month/year `scope` refers to. " +
            "Default: today. Ignored when both `from` and `to` are supplied.",
        },
        from: {
          type: "string",
          description:
            "Explicit range start (ISO 8601 date). Must be paired with `to`; together they " +
            "override `scope`/`date`.",
        },
        to: {
          type: "string",
          description: "Explicit range end (ISO 8601 date). Must be paired with `from`.",
        },
        include_logs: {
          type: "boolean",
          description:
            "When true, include the raw reading-log entries (`logs[]`) in the response. Default false.",
        },
      },
    },
  },
];

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

async function api(path, { method = "GET", body, auth = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (auth) {
    if (!TOKEN) {
      throw new Error(
        "This tool requires a SansFiction bearer token. Set the SANSFICTION_TOKEN environment variable (generate one at " +
          BASE +
          "/docs/agents)."
      );
    }
    headers.Authorization = `Bearer ${TOKEN}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${text}`);
  return text;
}

const ok = (text) => ({ content: [{ type: "text", text }] });

const server = new Server(
  { name: "sansfiction", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...PUBLIC_TOOLS, ...LIBRARY_TOOLS],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: a = {} } = req.params;
  try {
    switch (name) {
      case "search_books":
        return ok(await api(`/api/v1/catalog/search${qs({ q: a.query, limit: a.limit, searchType: a.searchType })}`));
      case "get_book":
        return ok(await api(`/api/v1/catalog/books/${encodeURIComponent(a.book_id)}${qs({ edition_id: a.edition_id })}`));
      case "get_series":
        return ok(await api(`/api/v1/catalog/series/${encodeURIComponent(a.series_id)}`));
      case "list_public_collections":
        return ok(await api(`/api/v1/catalog/collections${qs({ limit: a.limit, offset: a.offset })}`));

      case "list_my_books":
        return ok(await api(`/api/v1/library/books${qs({ status: a.status, limit: a.limit })}`, { auth: true }));
      case "add_book_to_library":
        return ok(
          await api(`/api/v1/library/books`, {
            method: "POST",
            auth: true,
            body: { book_id: a.book_id, status: a.status, edition_id: a.edition_id },
          })
        );
      case "update_library_book":
        return ok(
          await api(`/api/v1/library/books/${encodeURIComponent(a.book_id)}`, {
            method: "PATCH",
            auth: true,
            body: {
              status: a.status,
              rating: a.rating,
              review: a.review,
              started_at: a.started_at,
              finished_at: a.finished_at,
              current_page: a.current_page,
            },
          })
        );
      case "remove_book_from_library":
        return ok(
          await api(`/api/v1/library/books/${encodeURIComponent(a.book_id)}`, { method: "DELETE", auth: true })
        );
      case "search_my_library":
        return ok(
          await api(`/api/v1/library/search${qs({ q: a.query, status: a.status, limit: a.limit })}`, { auth: true })
        );
      case "list_my_collections":
        return ok(await api(`/api/v1/library/collections${qs({ limit: a.limit, query: a.query })}`, { auth: true }));
      case "get_reading_stats":
        return ok(
          await api(
            `/api/v1/library/stats${qs({ scope: a.scope, date: a.date, from: a.from, to: a.to, include_logs: a.include_logs })}`,
            { auth: true }
          )
        );

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return { content: [{ type: "text", text: String(err?.message || err) }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("sansfiction-mcp running on stdio");
