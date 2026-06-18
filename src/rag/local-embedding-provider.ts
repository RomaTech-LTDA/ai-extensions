import type { IEmbeddingProvider } from '../shared/models';

const DEFAULT_DIMENSIONS = 256;

/**
 * A lightweight local embedding provider using character n-gram hashing.
 * Suitable for small-to-medium APIs without external dependencies.
 * For production use with large APIs, swap in OpenAI or Ollama adapters.
 */
export class LocalEmbeddingProvider implements IEmbeddingProvider {
  readonly dimensions = DEFAULT_DIMENSIONS;

  async generateEmbedding(text: string): Promise<number[]> {
    return this.generateHashEmbedding(text);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.generateHashEmbedding(t));
  }

  private generateHashEmbedding(text: string): number[] {
    const embedding = new Array<number>(DEFAULT_DIMENSIONS).fill(0);
    const normalizedText = text.toLowerCase();
    const words = normalizedText.split(/\s+/).filter(Boolean);

    for (const word of words) {
      // Character trigrams for better semantic capture
      for (let i = 0; i <= word.length - 3; i++) {
        const trigram = word.substring(i, i + 3);
        const hash = this.getStableHash(trigram);
        const index = Math.abs(hash) % DEFAULT_DIMENSIONS;
        embedding[index] += hash > 0 ? 1.0 : -1.0;
      }

      // Character bigrams for short words
      for (let i = 0; i <= word.length - 2; i++) {
        const bigram = word.substring(i, i + 2);
        const hash = this.getStableHash(`bi_${bigram}`);
        const index = Math.abs(hash) % DEFAULT_DIMENSIONS;
        embedding[index] += 0.5;
      }

      // Whole word hashing with higher weight
      const wordHash = this.getStableHash(word);
      const wordIndex = Math.abs(wordHash) % DEFAULT_DIMENSIONS;
      embedding[wordIndex] += 3.0;

      // Word length feature (helps distinguish short vs long identifiers)
      const lenHash = this.getStableHash(`len_${Math.min(word.length, 10)}`);
      const lenIndex = Math.abs(lenHash) % DEFAULT_DIMENSIONS;
      embedding[lenIndex] += 0.3;
    }

    // L2 normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }

    return embedding;
  }

  private getStableHash(input: string): number {
    let hash = 17;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 31 + input.charCodeAt(i)) | 0; // force 32-bit int
    }
    return hash;
  }
}
