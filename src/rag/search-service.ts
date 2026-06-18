import type { IEndpointDiscoveryProvider } from '../shared/models';
import type { RagOptions } from './options';
import { DEFAULT_RAG_OPTIONS } from './options';
import type { SearchResult } from './semantic-indexer';
import { SemanticIndexer } from './semantic-indexer';

/**
 * Service that exposes RAG search capabilities and manages index lifecycle.
 */
export class RagSearchService {
  private readonly _options: Required<RagOptions>;
  private _lastIndexedAt = 0;

  constructor(
    private readonly _indexer: SemanticIndexer,
    private readonly _discoveryProvider: IEndpointDiscoveryProvider,
    options?: RagOptions,
  ) {
    this._options = { ...DEFAULT_RAG_OPTIONS, ...options };
  }

  /**
   * Initializes the RAG index by discovering endpoints and building embeddings.
   */
  async initialize(): Promise<void> {
    const endpoints = await this._discoveryProvider.discoverEndpoints();
    await this._indexer.index(endpoints);
    this._lastIndexedAt = Date.now();
  }

  /**
   * Performs a semantic search across indexed API documentation.
   * Automatically rebuilds the index if TTL has expired.
   */
  async search(query: string): Promise<SearchResult[]> {
    const needsRebuild = !this._indexer.isIndexed || this.isIndexExpired();

    if (needsRebuild) {
      await this.initialize();
    }

    return this._indexer.search(query, this._options.maxSearchResults, this._options.minimumSimilarity);
  }

  /**
   * Forces a rebuild of the semantic index.
   */
  async rebuild(): Promise<void> {
    await this.initialize();
  }

  private isIndexExpired(): boolean {
    if (this._options.indexTtlMs <= 0) return false;
    return Date.now() - this._lastIndexedAt > this._options.indexTtlMs;
  }
}
