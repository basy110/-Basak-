import React from 'react';
import { describe, expect, it } from 'vitest';
import { baseWidth, fitWidths, MAIN_CAP, MAIN_W, nodeText } from './tableLayout';

describe('nodeText', () => {
  it('reads nested titles', () => {
    expect(nodeText(React.createElement('span', null, 'الجامعة', React.createElement('i', null, '↑')))).toBe('الجامعة↑');
    expect(nodeText(null)).toBe('');
  });
});

describe('baseWidth', () => {
  it('prefers the admin’s width, then the page’s, then a default', () => {
    expect(baseWidth({ key: 'a', w: 120 }, false, { a: 200 })).toBe(200);
    expect(baseWidth({ key: 'a', w: 120 }, false)).toBe(120);
    expect(baseWidth({ key: 'name' }, true)).toBe(MAIN_W);
    expect(baseWidth({ key: 'go', w: 48 }, false, {})).toBe(48);
  });
});

describe('fitWidths', () => {
  it('shrinks together on a narrow screen, but not past MIN_SCALE', () => {
    expect(fitWidths([300, 200, 48], 448).widths).toEqual([240, 160, 48]);
    expect(fitWidths([300, 200], 100).widths).toEqual([210, 140]);
  });
  it('caps the first column and shares the rest with the others', () => {
    // name 260, university 200, line 150, chevron 48; a 1900px table.
    const { widths } = fitWidths([260, 200, 150, 48], 1900);
    expect(widths[0]).toBe(MAIN_CAP);
    expect(widths[3]).toBe(48);
    // The others split what is left (1900 - 360 - 48 = 1492) as 200 : 150.
    expect(widths[1]).toBe(Math.floor(200 * (1492 / 350)));
    expect(widths[2]).toBe(Math.floor(150 * (1492 / 350)));
    expect(widths.reduce((a, w) => a + w, 0)).toBeLessThanOrEqual(1900);
  });
  it('lets the first column grow less than the cap when there is little room', () => {
    const { widths } = fitWidths([260, 200], 520);
    expect(widths[0]).toBe(Math.floor(260 * (520 / 460)));
  });
  it('keeps a first column the admin made wider than the cap', () => {
    expect(fitWidths([500, 200], 1400).widths[0]).toBe(500);
  });
  it('lets a lone column take everything', () => {
    expect(fitWidths([260, 48], 1000).widths).toEqual([952, 48]);
  });
  it('reports each column’s growth factor', () => {
    const { widths, factors } = fitWidths([260, 200, 150, 48], 1900);
    factors.forEach((f, i) => expect(Math.round(f * [260, 200, 150, 48][i])).toBe(widths[i]));
  });
});
