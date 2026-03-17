import { describe, it, expect } from 'vitest';
import { MAX_BLOCKS, OUTPUT_LIMIT_PER_BLOCK } from '../components/Terminal';

describe('Scrollback buffer constants', () => {
  it('test_output_limit_constant_is_500000', () => {
    expect(OUTPUT_LIMIT_PER_BLOCK).toBe(500_000);
  });

  it('test_max_blocks_is_500', () => {
    expect(MAX_BLOCKS).toBe(500);
  });
});
