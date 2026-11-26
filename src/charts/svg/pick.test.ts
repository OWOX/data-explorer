import { describe, expect, it, vi } from 'vitest';
import { pickProps } from './pick';

describe('pickProps', () => {
  it('makes a mark a labelled button', () => {
    const p = pickProps('Filter to Kyiv', () => {});
    expect(p.role).toBe('button');
    expect(p.tabIndex).toBe(0);
    expect(p['aria-label']).toBe('Filter to Kyiv');
  });
  it('picks on click, Enter and Space, and on no other key', () => {
    const fn = vi.fn();
    const p = pickProps('x', fn);
    p.onClick();
    p.onKeyDown({ key: 'Enter', preventDefault() {} } as never);
    p.onKeyDown({ key: ' ', preventDefault() {} } as never);
    p.onKeyDown({ key: 'a', preventDefault() {} } as never);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
