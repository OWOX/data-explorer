/**
 * Puts text on the clipboard: the async API first, then a hidden textarea and `execCommand('copy')`. The plugin runs in
 * a sandboxed iframe that may block both, so the answer says whether either worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* blocked: try the fallback */ }
  const box = document.createElement('textarea');
  try {
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(box);
    box.focus();
    box.select();
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    box.remove();
  }
}
