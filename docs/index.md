---
layout: home
hero:
  name: "@romatech/ai-extensions"
  text: AI Enablement for Node.js APIs
  tagline: Transform your Express, Fastify, Koa, Hono, NestJS, Next.js, tRPC, or Lambda endpoints into MCP tools and RAG-enabled knowledge sources — decorator-based, zero config.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/RomaTech-LTDA/ai-extensions-node
features:
  - title: MCP Server
    details: Full Model Context Protocol — tools, resources, prompts, completions. Expose API endpoints as MCP tools for Claude, GPT, and other LLMs.
  - title: RAG Search
    details: Semantic search across your API documentation with built-in rag_search tool. Local, OpenAI, or Ollama embedding providers.
  - title: Multi-Framework
    details: Express, Fastify, Koa, Hono, NestJS, Next.js, tRPC, AWS Lambda — auto-detected by useAi().
  - title: Decorator-based
    details: "@AiTool, @AiHidden, @AiDescription, @AiCategory, @AiRole, @AiRateLimit — like .NET attributes."
  - title: Security Built-in
    details: Secure by default (API key or your own authenticate hook), role enforcement, Origin checks, per-client rate limiting, opt-in circuit breaker, audit log.
  - title: Zero Dependencies
    details: Core works without OpenAI/Ollama. Local embedding provider included for offline RAG.
---
