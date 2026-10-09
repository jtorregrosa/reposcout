import type { Db } from '../db';

export class InventoryService {
  constructor(private readonly db: Db) {}

  // Called by checkout for every line of an order; several checkouts run at once.
  async reserve(sku: string, qty: number): Promise<boolean> {
    const [item] = await this.db.query<{ stock: number }>('SELECT stock FROM inventory WHERE sku = ?', [sku]);
    if (!item || item.stock < qty) return false;
    await this.db.query('UPDATE inventory SET stock = ? WHERE sku = ?', [item.stock - qty, sku]);
    return true;
  }

  // Called when an order is cancelled; the caller tells the customer the items are back in stock.
  async release(sku: string, qty: number): Promise<boolean> {
    try {
      await this.db.query('UPDATE inventory SET stock = stock + ? WHERE sku = ?', [qty, sku]);
    } catch {
      // ignore
    }
    return true;
  }
}
