# Security

## Authentication

Protect your MCP endpoint with an API key:

```ts
useAi(app, {
  mcp: {
    apiKey: process.env.MCP_API_KEY,
  },
});
```

Clients must include the key in the `Authorization` header:

```
Authorization: Bearer your-api-key
```

## Authorization Forwarding

To forward the caller's auth token to tool endpoints:

```ts
useAi(app, {
  mcp: {
    forwardAuthorization: true,
  },
});
```

## CORS

Configure allowed origins:

```ts
useAi(app, {
  mcp: {
    cors: ['https://my-app.com', 'http://localhost:3000'],
    // or cors: '*' for development
  },
});
```

## Input Sanitization

⚠️ **Important:** Arguments received from LLMs via `tools/call` are validated against the input schema (required fields, types), but are NOT deeply sanitized.

If your endpoints perform:
- SQL queries → use parameterized queries (ORM handles this)
- Shell commands → never interpolate arguments into command strings
- File operations → validate paths against an allowlist

The framework validates types and required fields, but application-level validation is your responsibility.

## Rate Limiting

Per-tool rate limiting is enabled by default:

```ts
registerAiMetadata('POST', '/api/orders', aiTool({
  toolName: 'create_order',
  rateLimit: 10, // 10 requests per minute for this tool
}));
```

Global rate limit (default 60/min) applies to tools without specific limits.

## Best Practices

1. Always set `apiKey` in production
2. Use `aiHidden()` for sensitive endpoints (delete, admin)
3. Set appropriate `rateLimit` per tool
4. Keep MCP behind a reverse proxy with TLS
5. Monitor tool usage via `metrics.getAll()`
