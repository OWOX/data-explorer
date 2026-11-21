import { render } from '@testing-library/react';
import { fillHeight, useFillHeight } from './useFillHeight';

function Band() {
  useFillHeight('band');
  return <main style={{ paddingBottom: '48px' }}><section id="band" /></main>;
}

test('the fill is the viewport below the band, less the page padding', () => {
  const { container } = render(<main style={{ paddingBottom: '48px' }}><section /></main>);
  const el = container.querySelector('section')!;
  el.getBoundingClientRect = () => ({ top: 300 }) as DOMRect;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  expect(fillHeight(el)).toBe(552);
});

test('the hook writes --dm-fill and follows a resize', () => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  const proto = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = () => ({ top: 200 }) as DOMRect;
  try {
    render(<Band />);
    const el = document.getElementById('band')!;
    expect(el.style.getPropertyValue('--dm-fill')).toBe('652px');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    window.dispatchEvent(new Event('resize'));
    expect(el.style.getPropertyValue('--dm-fill')).toBe('352px');
  } finally {
    HTMLElement.prototype.getBoundingClientRect = proto;
  }
});
