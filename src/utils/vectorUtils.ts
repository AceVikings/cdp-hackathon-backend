/**
 * Calculate cosine similarity between two vectors
 * @param vecA First vector
 * @param vecB Second vector
 * @returns Similarity score between -1 and 1
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  if (vecA.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Calculate dot product of two vectors
 * @param vecA First vector
 * @param vecB Second vector
 * @returns Dot product
 */
export function dotProduct(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  let product = 0;
  for (let i = 0; i < vecA.length; i++) {
    product += vecA[i] * vecB[i];
  }

  return product;
}

/**
 * Calculate the magnitude (norm) of a vector
 * @param vector Input vector
 * @returns Vector magnitude
 */
export function magnitude(vector: number[]): number {
  let sum = 0;
  for (const value of vector) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}

/**
 * Normalize a vector to unit length
 * @param vector Input vector
 * @returns Normalized vector
 */
export function normalizeVector(vector: number[]): number[] {
  const norm = magnitude(vector);
  if (norm === 0) {
    return vector.slice(); // Return copy of original vector if norm is 0
  }
  return vector.map((val) => val / norm);
}

/**
 * Calculate Euclidean distance between two vectors
 * @param vecA First vector
 * @param vecB Second vector
 * @returns Euclidean distance
 */
export function euclideanDistance(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  let sum = 0;
  for (let i = 0; i < vecA.length; i++) {
    const diff = vecA[i] - vecB[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/**
 * Calculate Manhattan distance between two vectors
 * @param vecA First vector
 * @param vecB Second vector
 * @returns Manhattan distance
 */
export function manhattanDistance(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  let sum = 0;
  for (let i = 0; i < vecA.length; i++) {
    sum += Math.abs(vecA[i] - vecB[i]);
  }

  return sum;
}

/**
 * Find the most similar vectors from a list based on cosine similarity
 * @param queryVector The query vector
 * @param vectors Array of vectors to compare against
 * @param topK Number of top similar vectors to return
 * @returns Array of objects with vector index and similarity score
 */
export function findMostSimilar(
  queryVector: number[],
  vectors: number[][],
  topK: number = 5
): Array<{ index: number; similarity: number; vector: number[] }> {
  const similarities = vectors.map((vector, index) => ({
    index,
    similarity: cosineSimilarity(queryVector, vector),
    vector,
  }));

  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

/**
 * Check if two vectors are approximately equal within a tolerance
 * @param vecA First vector
 * @param vecB Second vector
 * @param tolerance Tolerance for comparison (default: 1e-10)
 * @returns True if vectors are approximately equal
 */
export function vectorsEqual(
  vecA: number[],
  vecB: number[],
  tolerance: number = 1e-10
): boolean {
  if (vecA.length !== vecB.length) {
    return false;
  }

  for (let i = 0; i < vecA.length; i++) {
    if (Math.abs(vecA[i] - vecB[i]) > tolerance) {
      return false;
    }
  }

  return true;
}

/**
 * Add two vectors element-wise
 * @param vecA First vector
 * @param vecB Second vector
 * @returns Sum of the vectors
 */
export function addVectors(vecA: number[], vecB: number[]): number[] {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  return vecA.map((val, index) => val + vecB[index]);
}

/**
 * Subtract two vectors element-wise
 * @param vecA First vector
 * @param vecB Second vector
 * @returns Difference of the vectors (vecA - vecB)
 */
export function subtractVectors(vecA: number[], vecB: number[]): number[] {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  return vecA.map((val, index) => val - vecB[index]);
}

/**
 * Multiply a vector by a scalar
 * @param vector Input vector
 * @param scalar Scalar value
 * @returns Scaled vector
 */
export function scaleVector(vector: number[], scalar: number): number[] {
  return vector.map((val) => val * scalar);
}

/**
 * Calculate the mean of multiple vectors
 * @param vectors Array of vectors
 * @returns Mean vector
 */
export function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    throw new Error("Cannot calculate mean of empty vector array");
  }

  const dimensions = vectors[0].length;
  const mean = new Array(dimensions).fill(0);

  for (const vector of vectors) {
    if (vector.length !== dimensions) {
      throw new Error("All vectors must have the same dimensions");
    }
    for (let i = 0; i < dimensions; i++) {
      mean[i] += vector[i];
    }
  }

  return mean.map((val) => val / vectors.length);
}
