/**
 * Configuration options for the RAG layer.
 */
export interface RagOptions {
  /** Maximum number of results to return from a search query. Default: 10 */
  maxSearchResults?: number;
  /** Minimum similarity score (0.0 to 1.0) for results to be included. Default: 0.3 */
  minimumSimilarity?: number;
  /** Whether to automatically rebuild the index when endpoints change. Default: true */
  autoRebuildIndex?: boolean;
}

export const DEFAULT_RAG_OPTIONS: Required<RagOptions> = {
  maxSearchResults: 10,
  minimumSimilarity: 0.3,
  autoRebuildIndex: true,
};
