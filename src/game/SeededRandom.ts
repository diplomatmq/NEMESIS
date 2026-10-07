/**
 * Seeded Random Number Generator
 * Ensures deterministic enemy generation based on floor and season
 */
export class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * Generate seeded random number between 0 and 1
   * Using Mulberry32 algorithm for fast, simple PRNG
   */
  next(): number {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  /**
   * Generate random integer between min (inclusive) and max (inclusive)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Generate random float between min and max
   */
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /**
   * Choose random element from array
   */
  choose<T>(array: T[]): T {
    return array[this.nextInt(0, array.length - 1)];
  }

  /**
   * Shuffle array deterministically
   */
  shuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Create seed from floor and season
   */
  static createSeed(floor: number, seasonId: number): number {
    // Combine floor and season into deterministic seed
    return (floor * 31 + seasonId * 17) & 0xFFFFFFFF;
  }

  /**
   * Create seeded random generator for specific floor and season
   */
  static forFloor(floor: number, seasonId: number): SeededRandom {
    const seed = this.createSeed(floor, seasonId);
    return new SeededRandom(seed);
  }
}
