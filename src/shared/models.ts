/**
 * Defines how an endpoint is exposed to AI consumers.
 */
export enum AiExposureLevel {
  /** The endpoint is completely hidden from AI systems. */
  Hidden = 0,
  /** The endpoint is available for RAG/documentation but not executable. */
  ReadOnly = 1,
  /** The endpoint is a fully executable MCP tool. */
  Executable = 2,
}

/**
 * Describes a discovered API endpoint with AI-relevant metadata.
 */
export interface AiEndpointDescriptor {
  /** The tool name used for MCP registration. */
  toolName: string;
  /** HTTP method (GET, POST, PUT, DELETE, etc.). */
  httpMethod: string;
  /** The route template for this endpoint. */
  route: string;
  /** Human-readable description for AI consumers. */
  description?: string;
  /** The category grouping for semantic organization. */
  category?: string;
  /** Required role for executing this tool. */
  requiredRole?: string;
  /** Rate limit in requests per minute. */
  rateLimitPerMinute?: number;
  /** Priority for RAG context ranking (higher = more important). */
  contextPriority: number;
  /** The AI exposure level for this endpoint. */
  exposureLevel: AiExposureLevel;
  /** JSON Schema for the input parameters. */
  inputSchema?: object;
  /** JSON Schema for the output/response. */
  outputSchema?: object;
  /** The operation ID from OpenAPI spec. */
  operationId?: string;
}

/**
 * Contract for discovering API endpoints.
 */
export interface IEndpointDiscoveryProvider {
  discoverEndpoints(): Promise<AiEndpointDescriptor[]>;
}

/**
 * Contract for generating embeddings.
 */
export interface IEmbeddingProvider {
  dimensions: number;
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
}
