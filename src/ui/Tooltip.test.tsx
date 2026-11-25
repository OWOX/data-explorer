import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { HoverableTooltipProvider, Tooltip, TooltipProvider } from './Tooltip';

const tip = (content: string) => <TooltipProvider><Tooltip content={content}><button type="button">Badge</button></Tooltip></TooltipProvider>;

test('a tooltip with no content stays shut and gives its trigger no aria-describedby', async () => {
  render(tip(''));
  await userEvent.hover(screen.getByRole('button', { name: 'Badge' }));
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(screen.getByRole('button', { name: 'Badge' })).not.toHaveAttribute('aria-describedby');
});

test('content that arrives while the trigger is hovered shows at once; content that goes and comes back does not reopen it unhovered', async () => {
  const { rerender } = render(tip(''));
  const button = screen.getByRole('button', { name: 'Badge' });
  await userEvent.hover(button);
  // Past the open delay: the tip is open in state, with nothing to show yet.
  await new Promise((r) => setTimeout(r, 300));
  rerender(tip('3 filters'));
  expect((await screen.findAllByText('3 filters')).length).toBeGreaterThan(0);
  rerender(tip(''));
  await userEvent.unhover(button);
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  rerender(tip('3 filters'));
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('a press while the tip has no content keeps it shut when content arrives', async () => {
  const { rerender } = render(tip(''));
  const button = screen.getByRole('button', { name: 'Badge' });
  await userEvent.hover(button);
  await new Promise((r) => setTimeout(r, 300));
  await userEvent.click(button);
  rerender(tip('3 filters'));
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.queryByRole('tooltip')).toBeNull();
});

// A tooltip with `copyText`: a bubble the pointer can enter, with a copy button in its corner.
const copyTip = (text = 'Paid: $9,299 (23%)', props: { side?: 'right' | 'top'; onClick?: () => void } = {}) => (
  <TooltipProvider><div onClick={props.onClick}><Tooltip content={text} copyText={text} side={props.side}><button type="button">Node</button></Tooltip><button type="button">Other</button></div></TooltipProvider>
);
const copyButton = () => screen.getByRole('button', { name: 'Copy to clipboard' });
const writeText = vi.fn<(t: string) => Promise<void>>();
const withClipboard = () => { writeText.mockReset(); writeText.mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true }); };
afterEach(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });

test('a tooltip with no copyText has no copy button and opens on top', async () => {
  render(tip('Hello'));
  await userEvent.hover(screen.getByRole('button', { name: 'Badge' }));
  expect(await screen.findByRole('tooltip')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copy to clipboard' })).toBeNull();
  expect(document.querySelector('.dm-hint-body')).toHaveAttribute('data-side', 'top');
});

test('side opens the bubble on that side', async () => {
  render(copyTip('Paid: $9,299', { side: 'right' }));
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  await screen.findByRole('tooltip');
  expect(document.querySelector('.dm-hint-body')).toHaveAttribute('data-side', 'right');
});

test('nothing of the copy button is mounted while the tooltip is shut', async () => {
  render(copyTip());
  expect(screen.queryByRole('button', { name: 'Copy to clipboard' })).toBeNull();
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  await screen.findByRole('tooltip');
  expect(copyButton()).toBeInTheDocument();
});

test('the hidden tooltip is the plain text with no button in it; the visible bubble holds the button', async () => {
  render(copyTip());
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  const hidden = await screen.findByRole('tooltip');
  expect(hidden.textContent).toBe('Paid: $9,299 (23%)');
  expect(hidden.querySelector('button')).toBeNull();
  expect(document.querySelector('.dm-hint-body')).toContainElement(copyButton());
});

test('keyboard focus on the trigger opens it with its text', async () => {
  render(copyTip());
  await userEvent.tab();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Paid: $9,299 (23%)');
});

test('the pointer can move from the trigger into the bubble and the bubble stays (jsdom has no layout: the e2e covers leaving it)', async () => {
  render(copyTip());
  const node = screen.getByRole('button', { name: 'Node' });
  await userEvent.hover(node);
  await screen.findByRole('tooltip');
  await userEvent.unhover(node);
  const bubble = document.querySelector<HTMLElement>('.dm-hint-body')!;
  await userEvent.hover(bubble);
  await new Promise((r) => setTimeout(r, 400));
  expect(document.querySelector('.dm-hint-body')).not.toBeNull();
});

test('a tooltip with no copyText still closes the moment the pointer leaves the trigger', async () => {
  render(tip('Hello'));
  const badge = screen.getByRole('button', { name: 'Badge' });
  await userEvent.hover(badge);
  await screen.findByRole('tooltip');
  await userEvent.unhover(badge);
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
});

test('Escape closes it', async () => {
  render(copyTip());
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  await screen.findByRole('tooltip');
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
});

test('Copy writes exactly the text, keeps the bubble open, turns into a check, and does not reach what is under the bubble', async () => {
  withClipboard();
  const outer = vi.fn();
  render(copyTip('Pürblack 30 grams: $9,299 (23%)', { onClick: outer }));
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  await screen.findByRole('tooltip');
  await userEvent.click(copyButton());
  expect(writeText).toHaveBeenCalledWith('Pürblack 30 grams: $9,299 (23%)');
  expect(outer).not.toHaveBeenCalled();
  await waitFor(() => expect(copyButton()).toHaveAttribute('data-copied'));
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  // About 1.5 s later the check goes back to the copy icon.
  await waitFor(() => expect(copyButton()).not.toHaveAttribute('data-copied'), { timeout: 3000 });
});

test('when neither way of copying works the bubble says so', async () => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) }, configurable: true });
  const exec = vi.fn().mockReturnValue(false);
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
  render(copyTip());
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  await screen.findByRole('tooltip');
  await userEvent.click(copyButton());
  expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  expect(exec).toHaveBeenCalledWith('copy');
});

// The bubble lets go: a hoverable one closes 200 ms after the pointer has stopped outside both it and the trigger.
const pair = (props: { onClick?: () => void } = {}) => (
  <HoverableTooltipProvider><div onClick={props.onClick} onPointerDown={props.onClick}>
    <Tooltip content="First: 1" copyText="First: 1" side="right"><button type="button">A</button></Tooltip>
    <Tooltip content="Second: 2" copyText="Second: 2" side="right"><button type="button">B</button></Tooltip>
  </div></HoverableTooltipProvider>
);
const bubble = () => document.querySelector<HTMLElement>('.dm-hint-body');

test('a hoverable bubble closes about 200 ms after the pointer left the trigger and stopped', async () => {
  render(pair());
  const a = screen.getByRole('button', { name: 'A' });
  await userEvent.hover(a);
  await screen.findByRole('tooltip');
  await userEvent.unhover(a);
  expect(bubble()).not.toBeNull();
  await waitFor(() => expect(bubble()).toBeNull(), { timeout: 1000 });
});

test('each pointermove on the page restarts the timer; entering the bubble cancels it', async () => {
  render(pair());
  const a = screen.getByRole('button', { name: 'A' });
  await userEvent.hover(a);
  await screen.findByRole('tooltip');
  await userEvent.unhover(a);
  for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 120)); fireEvent.pointerMove(document.body); }
  expect(bubble()).not.toBeNull();
  fireEvent.pointerEnter(bubble()!);
  await new Promise((r) => setTimeout(r, 500));
  expect(bubble()).not.toBeNull();
  fireEvent.pointerLeave(bubble()!);
  await waitFor(() => expect(bubble()).toBeNull(), { timeout: 1000 });
});

test('re-entering the trigger cancels the timer', async () => {
  render(pair());
  const a = screen.getByRole('button', { name: 'A' });
  await userEvent.hover(a);
  await screen.findByRole('tooltip');
  await userEvent.unhover(a);
  await userEvent.hover(a);
  await new Promise((r) => setTimeout(r, 500));
  expect(bubble()).not.toBeNull();
});

test('entering another trigger of the group closes the open bubble, and that trigger gets its own', async () => {
  render(pair());
  await userEvent.hover(screen.getByRole('button', { name: 'A' }));
  await screen.findByRole('tooltip');
  await userEvent.unhover(screen.getByRole('button', { name: 'A' }));
  await userEvent.hover(screen.getByRole('button', { name: 'B' }));
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Second: 2'));
  expect(document.querySelectorAll('.dm-hint-body')).toHaveLength(1);
});

test('crossing another trigger of the group on the way to the bubble leaves the bubble open', async () => {
  render(pair());
  const [a, b] = [screen.getByRole('button', { name: 'A' }), screen.getByRole('button', { name: 'B' })];
  await userEvent.hover(a);
  await screen.findByRole('tooltip');
  await userEvent.unhover(a);
  await userEvent.hover(b);
  await userEvent.unhover(b);
  await userEvent.hover(a);
  await new Promise((r) => setTimeout(r, 500));
  expect(screen.getByRole('tooltip')).toHaveTextContent('First: 1');
});

test('the pointer leaving the page closes the open bubble', async () => {
  render(pair());
  await userEvent.hover(screen.getByRole('button', { name: 'A' }));
  await screen.findByRole('tooltip');
  fireEvent.mouseLeave(document.documentElement);
  await waitFor(() => expect(bubble()).toBeNull());
});

test('a press or click inside the bubble does not reach what holds the tooltip', async () => {
  const outer = vi.fn();
  render(pair({ onClick: outer }));
  await userEvent.hover(screen.getByRole('button', { name: 'A' }));
  await screen.findByRole('tooltip');
  outer.mockClear();
  await userEvent.click(screen.getByText('First: 1', { selector: '.dm-hint-body span span' }));
  expect(outer).not.toHaveBeenCalled();
  expect(bubble()).not.toBeNull();
});

test('a wheel over the bubble closes it in full screen only', async () => {
  render(pair());
  await userEvent.hover(screen.getByRole('button', { name: 'A' }));
  await screen.findByRole('tooltip');
  fireEvent.wheel(bubble()!);
  expect(bubble()).not.toBeNull();
  const page = document.createElement('div');
  page.className = 'dm-full';
  document.body.appendChild(page);
  fireEvent.wheel(bubble()!);
  await waitFor(() => expect(bubble()).toBeNull());
  page.remove();
});

test('a hoverable tooltip is a Radix hoverable one; the plain ones are not', async () => {
  render(<TooltipProvider><Tooltip content="Hello" copyText="Hello"><button type="button">H</button></Tooltip></TooltipProvider>);
  await userEvent.hover(screen.getByRole('button', { name: 'H' }));
  await screen.findByRole('tooltip');
  // Radix keeps a hoverable bubble open between the trigger and itself: leaving the trigger alone does not close it at once.
  await userEvent.unhover(screen.getByRole('button', { name: 'H' }));
  expect(bubble()).not.toBeNull();
});

test('the hoverable bubble is clickable (CSS), and a long one fits a narrow viewport', () => {
  const css = readFileSync('src/ui/bands/bands.css', 'utf8');
  expect(css).toMatch(/\.dm-hint-hoverable \{[^}]*pointer-events: auto/);
  expect(css).toMatch(/\.dm-hint-hoverable \{[^}]*max-width: min\(22rem, var\(--radix-tooltip-content-available-width\)\)/);
});

// Copying: the fallback moves focus to a textarea, which must not close the bubble of a focused node.
const focused = (props: { clipboard: 'fail' | 'ok' }) => {
  Object.defineProperty(navigator, 'clipboard', { value: props.clipboard === 'fail' ? { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } : { writeText }, configurable: true });
};
const svgTip = (copy = 'Paid: $9') => (
  <HoverableTooltipProvider><svg><Tooltip content={copy} copyText={copy} side="right"><rect data-testid="node" tabIndex={0} width={5} height={5} /></Tooltip></svg></HoverableTooltipProvider>
);

test('fallback copy with the node focused keeps the bubble, shows the check and gives the node its focus back', async () => {
  focused({ clipboard: 'fail' });
  Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(true), configurable: true });
  render(svgTip());
  const node = screen.getByTestId('node');
  node.focus();
  await screen.findByRole('tooltip');
  await userEvent.click(copyButton());
  await waitFor(() => expect(copyButton()).toHaveAttribute('data-copied'));
  expect(bubble()).not.toBeNull();
  expect(document.activeElement).toBe(node);
});

test('fallback copy that fails too says so and keeps the bubble', async () => {
  focused({ clipboard: 'fail' });
  Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true });
  render(svgTip());
  const node = screen.getByTestId('node');
  node.focus();
  await screen.findByRole('tooltip');
  await userEvent.click(copyButton());
  expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  expect(bubble()).not.toBeNull();
  expect(document.activeElement).toBe(node);
});

test('pressing Copy while the node has focus does not move focus (mousedown is prevented)', async () => {
  withClipboard();
  render(svgTip());
  const node = screen.getByTestId('node');
  node.focus();
  await screen.findByRole('tooltip');
  await userEvent.click(copyButton());
  expect(document.activeElement).toBe(node);
  expect(bubble()).not.toBeNull();
});

test('a real blur still closes the bubble', async () => {
  render(<>{svgTip()}<button type="button">Elsewhere</button></>);
  screen.getByTestId('node').focus();
  await screen.findByRole('tooltip');
  screen.getByRole('button', { name: 'Elsewhere' }).focus();
  await waitFor(() => expect(bubble()).toBeNull());
});

test('the copied text is guarded like a grid cell, the shown text and the label are not', async () => {
  withClipboard();
  render(copyTip('=HYPERLINK("http://x","y")\tz\nw: $1'));
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  await screen.findByRole('tooltip');
  expect(screen.getByRole('tooltip').textContent).toBe('=HYPERLINK("http://x","y")\tz\nw: $1');
  await userEvent.click(copyButton());
  expect(writeText).toHaveBeenCalledWith('\'=HYPERLINK("http://x","y") z w: $1');
  expect(bubble()!.textContent).toContain('=HYPERLINK("http://x","y")\tz\nw: $1');
});

test('an ordinary label is copied unchanged', async () => {
  withClipboard();
  render(copyTip('Paid: $9,299 (23%)'));
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  await screen.findByRole('tooltip');
  await userEvent.click(copyButton());
  expect(writeText).toHaveBeenCalledWith('Paid: $9,299 (23%)');
});

test('the bubble held open by the pointer is closed when another trigger of the group settles', async () => {
  render(pair());
  await userEvent.hover(screen.getByRole('button', { name: 'A' }));
  await screen.findByRole('tooltip');
  await userEvent.unhover(screen.getByRole('button', { name: 'A' }));
  fireEvent.pointerEnter(bubble()!);
  fireEvent.pointerEnter(screen.getByRole('button', { name: 'B' }));
  await new Promise((r) => setTimeout(r, 500));
  expect(screen.getByRole('tooltip')).toHaveTextContent('Second: 2');
  expect(document.querySelectorAll('.dm-hint-body')).toHaveLength(1);
});

// Fallback copy while ANOTHER trigger has focus: the textarea round trip hands focus back to it, and its tooltip must not open and close the bubble being copied from.
const twoNodes = () => (
  <HoverableTooltipProvider><svg>
    <Tooltip content="First: 1" copyText="First: 1" side="right"><rect data-testid="a" tabIndex={0} width={5} height={5} /></Tooltip>
    <Tooltip content="Second: 2" copyText="Second: 2" side="right"><rect data-testid="b" tabIndex={0} width={5} height={5} /></Tooltip>
  </svg></HoverableTooltipProvider>
);
const noApi = (result: boolean) => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(result), configurable: true });
};

test.each([true, false])('fallback copy (works: %s) from one node while another has focus keeps the bubble and shows the answer', async (works) => {
  noApi(works);
  render(twoNodes());
  const [a, b] = [screen.getByTestId('a'), screen.getByTestId('b')];
  b.focus();
  await waitFor(() => expect(bubble()).not.toBeNull());
  await userEvent.hover(a);
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('First: 1'));
  await userEvent.click(copyButton());
  if (works) await waitFor(() => expect(copyButton()).toHaveAttribute('data-copied'));
  else expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  expect(screen.getByRole('tooltip')).toHaveTextContent('First: 1');
});

test('fallback copy from a hoverable bubble while a plain tooltip button has focus keeps the bubble and shows the answer', async () => {
  noApi(true);
  render(<HoverableTooltipProvider><Tooltip content="Plain"><button type="button">Plain</button></Tooltip><Tooltip content="First: 1" copyText="First: 1" side="right"><rect data-testid="a" tabIndex={0} /></Tooltip></HoverableTooltipProvider>);
  screen.getByRole('button', { name: 'Plain' }).focus();
  await userEvent.hover(screen.getByTestId('a'));
  await waitFor(() => expect(document.querySelector('.dm-hint-hoverable')).not.toBeNull());
  await userEvent.click(copyButton());
  await waitFor(() => expect(copyButton()).toHaveAttribute('data-copied'));
  expect(document.querySelector('.dm-hint-hoverable')).not.toBeNull();
});

test.each(['ok', 'failed', 'rejected'])('after a copy (%s) focusing a trigger opens its tooltip again', async (how) => {
  if (how === 'rejected') Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) }, configurable: true });
  else noApi(how === 'ok');
  Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(how === 'ok'), configurable: true });
  render(twoNodes());
  await userEvent.hover(screen.getByTestId('a'));
  await screen.findByRole('tooltip');
  await userEvent.click(copyButton());
  await waitFor(() => expect(screen.queryByText('Copy failed') ?? copyButton().hasAttribute('data-copied') ? true : null).toBeTruthy());
  await userEvent.unhover(screen.getByTestId('a'));
  await waitFor(() => expect(bubble()).toBeNull(), { timeout: 1000 });
  screen.getByTestId('b').focus();
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Second: 2'));
});

test("a consumer's own onFocus still runs while a copy is running", async () => {
  // A write that stays pending keeps a copy running, so the trigger's guarded onFocus branch is the one taken.
  let settle!: () => void;
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(() => new Promise<void>((r) => { settle = r; })) }, configurable: true });
  const onFocus = vi.fn();
  render(<HoverableTooltipProvider><Tooltip content="x" copyText="x"><button type="button" onFocus={onFocus}>F</button></Tooltip></HoverableTooltipProvider>);
  const trigger = screen.getByRole('button', { name: 'F' });
  await userEvent.hover(trigger);
  await screen.findByRole('tooltip');
  await userEvent.click(copyButton());
  trigger.focus();
  expect(onFocus).toHaveBeenCalledTimes(1);
  settle();
  await waitFor(() => expect(copyButton()).toHaveAttribute('data-copied'));
});

test('a touch pointer on a trigger of a group does not open a bubble after a hold', async () => {
  render(pair());
  const a = screen.getByRole('button', { name: 'A' });
  fireEvent.pointerEnter(a, { pointerType: 'touch' });
  fireEvent.pointerMove(a, { pointerType: 'touch' });
  await new Promise((r) => setTimeout(r, 500));
  expect(bubble()).toBeNull();
  fireEvent.pointerEnter(a, { pointerType: 'mouse' });
  await waitFor(() => expect(bubble()).not.toBeNull());
});

// A press inside the bubble holds the trigger's blur off until the pointer is released or cancelled.
const pressed = async (release: 'pointerup' | 'pointercancel' | null) => {
  render(svgTip());
  const node = screen.getByTestId('node');
  node.focus();
  await screen.findByRole('tooltip');
  fireEvent.pointerDown(bubble()!);
  if (release) fireEvent(document, new Event(release));
  return node;
};
test.each(['pointerup', 'pointercancel'] as const)('after %s the trigger\'s blur closes the bubble again', async (release) => {
  const node = await pressed(release);
  node.blur();
  await waitFor(() => expect(bubble()).toBeNull());
});
test('during the press the trigger\'s blur does not close the bubble', async () => {
  const node = await pressed(null);
  node.blur();
  await new Promise((r) => setTimeout(r, 100));
  expect(bubble()).not.toBeNull();
  fireEvent(document, new Event('pointerup'));
});
test('one release removes both press listeners', async () => {
  render(svgTip());
  screen.getByTestId('node').focus();
  await screen.findByRole('tooltip');
  const add = vi.spyOn(document, 'addEventListener'), remove = vi.spyOn(document, 'removeEventListener');
  fireEvent.pointerDown(bubble()!);
  fireEvent(document, new Event('pointercancel'));
  const press = (spy: typeof add) => spy.mock.calls.filter(([t]) => t === 'pointerup' || t === 'pointercancel');
  expect(press(add).map(([t]) => t).sort()).toEqual(['pointercancel', 'pointerup']);
  expect(press(remove).map(([t]) => t).sort()).toEqual(['pointercancel', 'pointerup']);
  expect(press(remove).map(([, f]) => f)).toEqual(expect.arrayContaining(press(add).map(([, f]) => f)));
  add.mockRestore(); remove.mockRestore();
});
