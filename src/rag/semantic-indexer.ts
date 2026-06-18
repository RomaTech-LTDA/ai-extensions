import type { AiEndpointDescriptor, IEmbeddingProvider } from '../shared/models';
import { AiExposureLevel } from '../shared/models';

/**
 * A document stored in the semantic index.
 */
export interface SemanticDocument {
  id: string;
  content: string;
  toolName: string;
  httpMethod: string;
  route: string;
  category?: string;
  priority: number;
  embedding?: number[];
}

/**
 * A search result with relevance score.
 */
export interface SearchResult {
  document: SemanticDocument;
  score: number;
}

/**
 * Builds and manages the semantic index from discovered endpoints.
 */
export class SemanticIndexer {
  private _documents: SemanticDocument[] = [];
  private _indexed = false;

  constructor(private readonly _embeddingProvider: IEmbeddingProvider) {}

  get isIndexed(): boolean {
    return this._indexed;
  }

  /**
   * Builds the semantic index from discovered endpoint descriptors.
   */
  async index(endpoints: AiEndpointDescriptor[]): Promise<void> {
    const eligible = endpoints.filter((e) => e.exposureLevel !== AiExposureLevel.Hidden);

    const documents = eligible.map((e) => this.buildDocument(e));
    const texts = documents.map((d) => d.content);
    const embeddings = await this._embeddingProvider.generateEmbeddings(texts);

    for (let i = 0; i < documents.length; i++) {
      documents[i].embedding = embeddings[i];
    }

    this._documents = documents;
    this._indexed = true;
  }

  /**
   * Searches the semantic index with a query and returns ranked results.
   */
  async search(query: string, maxResults = 10, minimumSimilarity = 0.3): Promise<SearchResult[]> {
    if (!this._indexed) return [];

    const queryEmbedding = await this._embeddingProvider.generateEmbedding(query);

    return this._documents
      .filter((d) => d.embedding != null)
      .map((d) => ({
        document: d,
        score: cosineSimilarity(queryEmbedding, d.embedding!),
      }))
      .filter((r) => r.score >= minimumSimilarity)
      .sort((a, b) => b.score - a.score || b.document.priority - a.document.priority)
      .slice(0, maxResults);
  }

  private buildDocument(endpoint: AiEndpointDescriptor): SemanticDocument {
    const parts = [`Endpoint: ${endpoint.httpMethod} ${endpoint.route}.`];

    if (endpoint.description) parts.push(`Description: ${endpoint.description}.`);
    if (endpoint.category) parts.push(`Category: ${endpoint.category}.`);
    parts.push(`Exposure: ${AiExposureLevel[endpoint.exposureLevel]}.`);

    return {
      id: `${endpoint.httpMethod}_${endpoint.route}`.replace(/\//g, '_'),
      content: parts.join(' '),
      toolName: endpoint.toolName,
      httpMethod: endpoint.httpMethod,
      route: endpoint.route,
      category: endpoint.category,
      priority: endpoint.contextPriority,
    };
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  return magnitude === 0 ? 0 : dot / magnitude;
}
