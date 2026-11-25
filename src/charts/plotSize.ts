const MIN_PLOT = 60;

/** The plot's height: `own` when the chart sizes itself (`room` null), else what `room` leaves after the `chrome` around the plot. */
export const plotHeight = (room: number | null, chrome: number, own: number): number => (room === null ? own : Math.max(MIN_PLOT, room - chrome));
/** A row's height: `own`, or more when a set height has room for it. Never less, so labels stay readable and the plot scrolls instead. */
export const rowHeight = (room: number | null, chrome: number, rows: number, own: number): number => (room === null ? own : Math.max(own, Math.floor((room - chrome) / Math.max(1, rows))));
