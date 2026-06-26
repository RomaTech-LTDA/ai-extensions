import type { IEmbeddingProvider } from '../shared/models';

/**
 * OpenAI embedding provider.
 * Uses the OpenAI API to generate high-quality embeddings.
 *
 * @example
 * ```ts
 * import { OpenAiEmbeddingProvider } from '@romatech/ai-extensions';
 *
 * useAi(app, {
 *     embeddingProvider: new OpenAiEmbeddingProvider({
 *         apiKey: process.env.OPENAI_API_KEY!,
 *     }),
 * });
 * ```
 */
export class OpenAiEmbeddingProvider implements IEmbeddingProvider {
  readonly dimensions: number;
  private readonly _apiKey: string;
  private readonly _model: string;
  private readonly _baseUrl: string;

  constructor(options: {
    apiKey: string;
    /** Model to use. Default: text-embedding-3-small */
    model?: string;
    /** API base URL. Default: https://api.openai.com/v1 */
    baseUrl?: string;
    /** Embedding dimensions. Default: 1536 */
    dimensions?: number;
  }) {
    this._apiKey = options.apiKey;
    this._model = options.model ?? 'text-embedding-3-small';
    this._baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    this.dimensions = options.dimensions ?? 1536;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const results = await this.callApi([text]);
    return results[0];
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // OpenAI supports batching up to 2048 inputs
    const batchSize = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const results = await this.callApi(batch);
      allEmbeddings.push(...results);
    }

    return allEmbeddings;
  }

  private async callApi(inputs: string[]): Promise<number[][]> {
    const response = await fetch(`${this._baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify({
        model: this._model,
        input: inputs,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${error}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map(d => d.embedding);
  }
}
