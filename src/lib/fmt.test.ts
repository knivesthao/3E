import { describe, expect, it } from 'vitest';
import { fmtMs } from './api';

describe('fmtMs', () => {
  it('renders milliseconds below one second', () => {
    expect(fmtMs(0)).toBe('0ms');
    expect(fmtMs(850)).toBe('850ms');
    expect(fmtMs(999)).toBe('999ms');
  });

  it('renders seconds with one decimal at and above one second', () => {
    expect(fmtMs(1000)).toBe('1.0s');
    expect(fmtMs(2300)).toBe('2.3s');
  });

  it('renders missing data as a dash', () => {
    expect(fmtMs(null)).toBe('—');
    expect(fmtMs(undefined)).toBe('—');
  });
});
