import type { Ctx } from './types';

/** A getter for one value per ctx, made on first use and kept while the ctx lives. */
export const perCtx = <T>(make: (ctx: Ctx) => T): ((ctx: Ctx) => T) => {
  const values = new WeakMap<Ctx, T>();
  return (ctx) => {
    let v = values.get(ctx);
    if (v === undefined) values.set(ctx, (v = make(ctx)));
    return v;
  };
};
