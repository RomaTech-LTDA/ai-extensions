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
    if (this._indexer.isIndexed) return;

    const endpoints = await this._discoveryProvider.discoverEndpoints();
    await this._indexer.index(endpoints);
  }

  /**
   * Performs a semantic search across indexed API documentation.
   */
  async search(query: string): Promise<SearchResult[]> {
    if (!this._indexer.isIndexed) {
      await this.initialize();
    }

    return this._indexer.search(query, this._options.maxSearchResults, this._options.minimumSimilarity);
  }
}
