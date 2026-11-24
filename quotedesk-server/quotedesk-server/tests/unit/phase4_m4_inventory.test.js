import { describe, it, expect, beforeEach } from 'vitest';
import * as inventory from '../../inventory.js';
import * as stockItems from '../../stock-items.js';

describe('M4: Inventory Management & Valuation Suite', () => {
  const companyId = 'test_m4_company_' + Math.random().toString(36).slice(2, 7);
  let sampleItem = null;

  beforeEach(async () => {
    sampleItem = await stockItems.createStockItem(companyId, {
      name: 'Curtain Wall Profile 6063 T6',
      stockGroupId: 'sg_raw_materials',
      unitName: 'Kg',
      hsnCode: '7604',
      taxRate: 18,
      openingQty: 100,
      openingRate: 200, // Rs 200/kg
      reorderLevel: 30
    });
  });

  describe('Stock Movements & Stock-On-Hand', () => {
    it('tracks inward and outward stock movements accurately', async () => {
      // Current opening stock = 100
      let onHand = await inventory.getStockOnHand(companyId, sampleItem.id);
      expect(onHand.closingQty).toBe(100);
      expect(onHand.closingValue).toBe(20000); // 100 * 200

      // Inward GRN of 50 kg @ Rs 220
      await inventory.recordStockMovement(companyId, {
        voucherId: 'vch_grn_01',
        voucherNo: 'GRN/26-27/0001',
        voucherType: 'receipt_note',
        stockItemId: sampleItem.id,
        stockItemName: sampleItem.name,
        qty: 50,
        rate: 220,
        direction: 'in'
      });

      onHand = await inventory.getStockOnHand(companyId, sampleItem.id);
      expect(onHand.closingQty).toBe(150); // 100 + 50
      expect(onHand.totalInQty).toBe(150);

      // Outward Delivery Challan of 40 kg
      await inventory.recordStockMovement(companyId, {
        voucherId: 'vch_dc_01',
        voucherNo: 'DC/26-27/0001',
        voucherType: 'delivery_note',
        stockItemId: sampleItem.id,
        stockItemName: sampleItem.name,
        qty: 40,
        rate: 200,
        direction: 'out'
      });

      onHand = await inventory.getStockOnHand(companyId, sampleItem.id);
      expect(onHand.closingQty).toBe(110); // 150 - 40
      expect(onHand.totalOutQty).toBe(40);
    });

    it('enforces Negative Stock Protection by rejecting over-dispatch', async () => {
      // Attempt to dispatch 500 kg when only 100 kg is in stock
      await expect(
        inventory.recordStockMovement(companyId, {
          voucherId: 'vch_dc_excess',
          voucherNo: 'DC/26-27/EXCESS',
          voucherType: 'delivery_note',
          stockItemId: sampleItem.id,
          stockItemName: sampleItem.name,
          qty: 500,
          rate: 200,
          direction: 'out'
        })
      ).rejects.toThrow(/Negative Stock Alert/);
    });
  });

  describe('FIFO Valuation & Reorder Alerts', () => {
    it('calculates FIFO stock valuation across multiple purchase batches', async () => {
      // Batch 1: Opening 100 @ Rs 200
      // Batch 2: Inward 50 @ Rs 250
      await inventory.recordStockMovement(companyId, {
        voucherId: 'vch_grn_b2',
        voucherNo: 'GRN/26-27/B2',
        voucherType: 'receipt_note',
        stockItemId: sampleItem.id,
        qty: 50,
        rate: 250,
        direction: 'in'
      });

      // Dispatch 110 units (consumes all 100 of Batch 1 @ 200 + 10 of Batch 2 @ 250)
      // Remaining stock should be 40 units strictly from Batch 2 @ Rs 250 = Rs 10,000
      await inventory.recordStockMovement(companyId, {
        voucherId: 'vch_dc_fifo',
        voucherNo: 'DC/26-27/FIFO',
        voucherType: 'delivery_note',
        stockItemId: sampleItem.id,
        qty: 110,
        rate: 200,
        direction: 'out'
      });

      const fifoVal = await inventory.valuateStockFIFO(companyId, sampleItem.id);
      expect(fifoVal.remainingQty).toBe(40);
      expect(fifoVal.effectiveRate).toBe(250);
      expect(fifoVal.valuationValue).toBe(10000); // 40 * 250
    });

    it('triggers reorder alerts when stock falls below reorder level', async () => {
      // Reorder level is 30. Dispatch 80 from 100 to leave 20 units.
      await inventory.recordStockMovement(companyId, {
        voucherId: 'vch_dc_reorder',
        voucherNo: 'DC/26-27/REORDER',
        voucherType: 'delivery_note',
        stockItemId: sampleItem.id,
        qty: 80,
        rate: 200,
        direction: 'out'
      });

      const alerts = await inventory.getReorderAlerts(companyId);
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts.some(a => a.stockItemId === sampleItem.id)).toBe(true);
    });

    it('generates Stock Summary Statement with total valuation', async () => {
      const summary = await inventory.getStockSummary(companyId);
      expect(summary.totalItems).toBeGreaterThanOrEqual(1);
      expect(typeof summary.totalStockValue).toBe('number');
      expect(summary.items.some(it => it.stockItemId === sampleItem.id)).toBe(true);
    });
  });
});
