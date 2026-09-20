import { describe, it, expect } from 'vitest';
import { wptKey, legKey, cellId, procKey, transKey, parseRunway } from '../src/navdata/keys';

describe('wptKey', () => {
  it('absorbs coordinate jitter below the 1e-5 grid', () => {
    expect(wptKey('TESTA', 'ZZ', 12.34567, 45.67891)).toBe(wptKey('TESTA', 'ZZ', 12.34567 + 4e-7, 45.67891 - 4e-7));
  });
  it('collapses negative zero', () => {
    expect(wptKey('A', 'ZZ', 0, 0)).toBe('A|ZZ|0|0');
    expect(wptKey('A', 'ZZ', -0, -0)).toBe('A|ZZ|0|0');
    expect(wptKey('A', 'ZZ', -4e-7, -4e-7)).toBe('A|ZZ|0|0');
  });
});

describe('legKey', () => {
  it('orders endpoints by JS < in both directions', () => {
    expect(legKey('T100', 'B|1|1', 'A|1|1')).toBe('T100|A|1|1|B|1|1');
    expect(legKey('T100', 'A|1|1', 'B|1|1')).toBe('T100|A|1|1|B|1|1');
  });
});

describe('cellId', () => {
  it('matches the grid corners and the peer fixed point', () => {
    expect(cellId(-90, -180)).toBe(0);
    expect(cellId(89.9, 179.9)).toBe(259199);
    expect(cellId(34.45, 134.04)).toBe(179188);
  });
});

describe('procKey / transKey', () => {
  it('joins with empty strings for nulls', () => {
    expect(procKey('TEST', 'SID', 'ALPHA1', null, null, null)).toBe('TEST|SID|ALPHA1|||');
    expect(procKey('TEST', 'APPROACH', 'ILS', 10, 2, 'Z')).toBe('TEST|APPROACH|ILS|10|2|Z');
    expect(transKey('TEST|SID|ALPHA1|||', 'common', 'X')).toBe('TEST|SID|ALPHA1||||common|X');
  });
});

describe('parseRunway', () => {
  it('parses the live-style strings', () => {
    const cases: Record<string, [number, number]> = {
      '01': [1, 0], '02': [2, 0], '07R': [7, 2], '08': [8, 0], '10': [10, 0], '10R': [10, 2],
      '13': [13, 0], '14': [14, 0], '15': [15, 0], '16R': [16, 2], '17': [17, 0], '19': [19, 0],
      '23': [23, 0], '26': [26, 0], '26L': [26, 1], '28L': [28, 1], '29': [29, 0], '31': [31, 0],
      '31R': [31, 2], '32L': [32, 1], '34': [34, 0], '34L': [34, 1], '34R': [34, 2],
    };
    for (const [s, [number, designator]] of Object.entries(cases)) {
      expect(parseRunway(s)).toEqual({ number, designator });
    }
    expect(parseRunway('09C')).toEqual({ number: 9, designator: 3 });
  });
  it('parses compass words', () => {
    expect(parseRunway('N')).toEqual({ number: 37, designator: 0 });
    expect(parseRunway('NE')).toEqual({ number: 38, designator: 0 });
    expect(parseRunway('NW')).toEqual({ number: 44, designator: 0 });
  });
  it('rejects everything else', () => {
    for (const s of ['', '7L9', '00', '37', '45', '10X', 'XX', ' ']) expect(parseRunway(s)).toBeNull();
    expect(parseRunway(null)).toBeNull();
  });
});
