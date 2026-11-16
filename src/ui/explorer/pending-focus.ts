// The Columns button that takes focus when a grid mounts: asked for when the main tab is removed and the next mart is promoted,
// because the grid then remounts (DataBand keys it by mart) and the focused button is gone.
let pending: string | null = null;

export const askFocusFor = (martId: string | null) => { pending = martId; };
export const dropFocusFor = (martId: string) => { if (pending === martId) pending = null; };
/** True once, for the mart that was asked for. */
export function takeFocusFor(martId: string): boolean {
  if (pending !== martId) return false;
  pending = null;
  return true;
}
export const isFocusAskedFor = (martId: string) => pending === martId;
