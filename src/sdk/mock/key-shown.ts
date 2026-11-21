import type { Ctx } from '../types';

/** Test helper: the orders grid opens on its key no longer, so a test about the key column starts from a grid saved with it. */
export function keyShown<T extends Ctx>(ctx: T): T {
  void ctx.collections('grid-columns').put('orders', { columns: ['id', 'customer_id', 'product_id', 'store_id', 'status'], at: new Date().toISOString() });
  return ctx;
}
