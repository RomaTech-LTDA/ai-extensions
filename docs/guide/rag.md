# RAG Search

RAG (Retrieval Augmented Generation) enables semantic search over your API endpoints.

## How It Works

1. All non-hidden endpoints are indexed with local embeddings
2. Queries are converted to embeddings and compared via cosine similarity
3. Results are ranked by relevance score and context priority

## Using RAG Programmatically

```ts
const { ragSearch } = useAi(app, options);

// Search for relevant endpoints
const results = await ragSearch.search('payment processing');

for (const result of results) {
  console.log(`${result.document.httpMethod} ${result.document.route} (score: ${result.score})`);
}
```

## Using RAG via MCP

RAG is also available as a built-in MCP tool called `rag_search`:

```json
{
  "method": "tools/call",
  "params": {
    "name": "rag_search",
    "arguments": { "query": "how to list users" }
  }
}
```

## Configuration

```ts
useAi(app, {
  rag: {
    maxSearchResults: 10,      // max results per query
    minimumSimilarity: 0.3,    // minimum score threshold (0-1)
    autoRebuildIndex: true,    // rebuild on endpoint changes
  },
});
```

## Custom Embedding Provider

Replace the local provider with OpenAI, Ollama, or any custom implementation:

```ts
import { IEmbeddingProvider } from '@romatech/ai-extensions';

class OpenAiEmbeddingProvider implements IEmbeddingProvider {
  dimensions = 1536;

  async generateEmbedding(text: string): Promise<number[]> {
    // Call OpenAI API
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Batch call
  }
}

useAi(app, {
  embeddingProvider: new OpenAiEmbeddingProvider(),
});
```
