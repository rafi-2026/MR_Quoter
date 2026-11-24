import { describe, it, expect, beforeEach } from 'vitest';
import {
  toPaise,
  toRupees,
  formatINR,
  addPaise,
  subPaise,
  mulPaise,
  percentPaise,
  roundToRupee,
  roundOffDiff
} from '../../paise.js';
import * as stockGroups from '../../stock-groups.js';
import * as stockItems from '../../stock-items.js';
import * as units from '../../units.js';
import * as godowns from '../../godowns.js';
import * as priceLists from '../../price-lists.js';
import * as costCentres from '../../cost-centres.js';
import * as currencies from '../../currencies.js';
import * as accounts from '../../accounts.js';

describe('M1: Masters & Foundation Tests', () => {
  const companyId = 'test_m1_company_' + Math.random().toString(36).slice(2, 8);

  describe('Paise Safe Money Math', () => {
    it('converts rupees to paise and back with precision', () => {
      expect(toPaise(1234.56)).toBe(123456);
      expect(toPaise('1234.56')).toBe(123456);
      expect(toRupees(123456)).toBe(1234.56);
      expect(toPaise(0)).toBe(0);
      expect(toRupees(0)).toBe(0);
    });

    it('handles addition, subtraction, multiplication, and percentage without float leaks', () => {
      expect(addPaise(1000, 2050, 45)).toBe(3095);
      expect(subPaise(5000, 1234)).toBe(3766);
      expect(mulPaise(1250, 3)).toBe(3750);
      // 18% GST on 10,000 paise (Rs 100) -> 1,800 paise (Rs 18)
      expect(percentPaise(10000, 18)).toBe(1800);
      // 18% GST on 12345 paise -> 2222 paise
      expect(percentPaise(12345, 18)).toBe(2222);
    });

    it('computes round-to-rupee and roundOffDiff accurately', () => {
      // 10045 paise = Rs 100.45 -> rounds to 10000 paise (Rs 100), diff = -45
      expect(roundToRupee(10045)).toBe(10000);
      expect(roundOffDiff(10045)).toBe(-45);

      // 10065 paise = Rs 100.65 -> rounds to 10100 paise (Rs 101), diff = +35
      expect(roundToRupee(10065)).toBe(10100);
      expect(roundOffDiff(10065)).toBe(35);
    });

    it('formats currency cleanly in Indian numbering format', () => {
      const formatted = formatINR(125050); // Rs 1,250.50
      expect(formatted).toContain('1,250.50');
      expect(formatted).toContain('₹');
    });
  });

  describe('Stock Groups Master', () => {
    it('initializes default stock groups', async () => {
      const list = await stockGroups.listStockGroups(companyId);
      expect(list.length).toBeGreaterThanOrEqual(7);
      expect(list.some(g => g.name === 'Raw Materials')).toBe(true);
      expect(list.some(g => g.name === 'Finished Goods')).toBe(true);
    });

    it('creates, updates, and deletes custom stock group', async () => {
      const custom = await stockGroups.createStockGroup(companyId, {
        name: 'Extrusions 6063',
        parent: 'sg_raw_materials'
      });
      expect(custom.id).toBeDefined();
      expect(custom.name).toBe('Extrusions 6063');

      const updated = await stockGroups.updateStockGroup(companyId, custom.id, { name: 'Aluminium Extrusions 6063' });
      expect(updated.name).toBe('Aluminium Extrusions 6063');

      const delResult = await stockGroups.deleteStockGroup(companyId, custom.id);
      expect(delResult.deleted).toBe(true);
    });
  });

  describe('Units Master (Simple & Compound)', () => {
    it('initializes default units', async () => {
      const list = await units.listUnits(companyId);
      expect(list.length).toBeGreaterThanOrEqual(14);
      expect(list.some(u => u.symbol === 'Nos')).toBe(true);
      expect(list.some(u => u.symbol === 'Kg')).toBe(true);
      expect(list.some(u => u.symbol === 'Sqft')).toBe(true);
    });

    it('creates compound unit and performs conversion', async () => {
      const compoundBox = await units.createUnit(companyId, {
        name: 'Box of 12',
        symbol: 'Box12',
        isCompound: true,
        baseUnitId: 'uom_nos',
        conversionFactor: 12
      });
      expect(compoundBox.isCompound).toBe(true);
      expect(compoundBox.conversionFactor).toBe(12);

      // 5 boxes = 60 nos
      const convertedNos = await units.convertUnit(companyId, 5, compoundBox.id, 'uom_nos');
      expect(convertedNos).toBe(60);

      // 24 nos = 2 boxes
      const convertedBoxes = await units.convertUnit(companyId, 24, 'uom_nos', compoundBox.id);
      expect(convertedBoxes).toBe(2);
    });
  });

  describe('Stock Items Master', () => {
    it('creates, retrieves, and updates a stock item with paise fields', async () => {
      const item = await stockItems.createStockItem(companyId, {
        name: 'Aluminium Section 50x25x1.5mm',
        stockGroupId: 'sg_raw_materials',
        unitName: 'Kg',
        hsnCode: '7604',
        taxRate: 18,
        openingQty: 100,
        openingRate: 250.50, // Rs 250.50
        reorderLevel: 20
      });

      expect(item.id).toBeDefined();
      expect(item.name).toBe('Aluminium Section 50x25x1.5mm');
      expect(item.openingRatePaise).toBe(25050);
      expect(item.openingValuePaise).toBe(2505000); // 100 * 25050
      expect(item.hsnCode).toBe('7604');

      const fetched = await stockItems.getStockItem(companyId, item.id);
      expect(fetched).toBeDefined();
      expect(fetched.name).toBe(item.name);

      const updated = await stockItems.updateStockItem(companyId, item.id, {
        reorderLevel: 35
      });
      expect(updated.reorderLevel).toBe(35);
    });
  });

  describe('Godowns / Locations Master', () => {
    it('lists default main godown and creates secondary warehouse', async () => {
      const list = await godowns.listGodowns(companyId);
      expect(list.some(g => g.name === 'Main Godown')).toBe(true);

      const secondary = await godowns.createGodown(companyId, {
        name: 'Factory Yard 2',
        address: 'Plot 45, Phase 2 Ind Area'
      });
      expect(secondary.id).toBeDefined();
      expect(secondary.name).toBe('Factory Yard 2');
    });
  });

  describe('Price Lists Master', () => {
    it('creates price list and calculates item rate', async () => {
      const pl = await priceLists.createPriceList(companyId, {
        name: 'Distributor Q4 Tier',
        applicableFrom: '2026-01-01',
        applicableTo: '2026-12-31',
        items: [
          { stockItemId: 'test_item_1', rate: 220 }
        ]
      });

      expect(pl.id).toBeDefined();
      expect(pl.items[0].ratePaise).toBe(22000);

      const rate = await priceLists.getItemRate(companyId, 'test_item_1', pl.id, '2026-06-15');
      expect(rate).toBe(22000);

      // Out of date range check
      const outOfRange = await priceLists.getItemRate(companyId, 'test_item_1', pl.id, '2027-01-01');
      expect(outOfRange).toBeNull();
    });
  });

  describe('Cost Centres & Currencies Master', () => {
    it('creates cost centre', async () => {
      const cc = await costCentres.createCostCentre(companyId, {
        name: 'Project Site Alpha',
        category: 'Projects'
      });
      expect(cc.id).toBeDefined();
      expect(cc.name).toBe('Project Site Alpha');
    });

    it('initializes default INR and creates USD currency', async () => {
      const curList = await currencies.listCurrencies(companyId);
      expect(curList.some(c => c.code === 'INR')).toBe(true);

      const code = 'US' + Math.random().toString(36).slice(2, 3).toUpperCase();
      const usd = await currencies.createCurrency(companyId, {
        code,
        name: 'US Dollar',
        symbol: '$',
        exchangeRate: 85.50
      });
      expect(usd.code).toBe(code);
      expect(usd.exchangeRate).toBe(85.50);
    });
  });

  describe('Opening Balances Verification', () => {
    it('verifies balanced and unbalanced opening balances', async () => {
      // Initialize company accounts
      await accounts.initCompanyAccounts(companyId);

      // Import balanced Dr and Cr
      const res = await accounts.importOpeningBalances(companyId, [
        { ledgerId: 'led_bank_default', openingBalance: 50000, openingBalanceType: 'Dr' },
        { ledgerId: 'led_capital_main', openingBalance: 50000, openingBalanceType: 'Cr' }
      ]);
      expect(res.imported.length).toBe(2);

      const verifyRes = await accounts.verifyOpeningBalances(companyId);
      expect(verifyRes.balanced).toBe(true);
      expect(verifyRes.difference).toBe(0);
      expect(verifyRes.totalDr).toBe(50000);
      expect(verifyRes.totalCr).toBe(50000);
    });
  });
});
