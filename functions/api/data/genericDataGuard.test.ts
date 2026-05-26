import { describe, expect, it } from 'vitest';
import { domainApiWriteMessage } from './[[table]]';

describe('generic data API domain write guards', () => {
  it('keeps expense writes on the expense domain endpoint', () => {
    expect(domainApiWriteMessage('expenses')).toBe('Expenses must use the expense API.');
  });

  it('does not block read-only tables without a domain write policy', () => {
    expect(domainApiWriteMessage('products')).toBeNull();
  });
});
