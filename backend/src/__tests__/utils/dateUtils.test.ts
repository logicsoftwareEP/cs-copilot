import { todayISO } from '../../utils/dateUtils';

describe('todayISO', () => {
  it('returns current date in YYYY-MM-DD format', () => {
    const result = todayISO();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Should match today's date
    const expected = new Date().toISOString().slice(0, 10);
    expect(result).toBe(expected);
  });
});
