import type { IEmbeddingProvider } from '../shared/models';

/**
 * Ollama embedding provider.
 * Uses a local Ollama instance — free, private, no API key needed.
 *
 * @example
 * ```ts
 * import { OllamaEmbeddingProvider } from '@romatech/ai-extensions';
 *
 * useAi(app, {
 *     embeddingProvider: new OllamaEmbeddingProvider({
 *         model: 'nomic-embed-text',  // or 'mxbai-embed-large'
 *     }),
 * });
 * ```
 *
 * Requires Ollama running locally: https://ollama.ai
 * Pull a model first: `ollama pull nomic-embed-text`
 */
export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  readonly dimensions: number;
  private readonly _model: string;
  private readonly _baseUrl: string;

  constructor(options?: {
    /** Model to use. Default: nomic-embed-text */
    model?: string;
    /** Ollama API URL. Default: http://localhost:11434 */
    baseUrl?: string;
    /** Expected dimensions. Default: 768 */
    dimensions?: number;
  }) {
    this._model = options?.model ?? 'nomic-embed-text';
    this._baseUrl = options?.baseUrl ?? 'http://localhost:11434';
    this.dimensions = options?.dimensions ?? 768;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await fetch(`${this._baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this._model, prompt: text }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama error (${response.status}): ${error}`);
    }

    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Ollama doesn't batch — call sequentially
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.generateEmbedding(text));
    }
    return results;
  }
}
