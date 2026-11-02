'use strict';
const fs = require('fs');
const path = require('path');
const costingEngine = require('./costing-engine');

const dbPath = path.join(__dirname, 'data', 'quotedesk.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

db.companyCostingSettings = db.companyCostingSettings || {};
db.materials = db.materials || [];
db.productTemplates = db.productTemplates || [];

const companyIds = ['master'];
(db.companies || []).forEach(c => {
  if (c && c.id && !companyIds.includes(c.id)) {
    companyIds.push(c.id);
  }
});

console.log('Seeding costing data for companies:', companyIds);

const defaultMaterialsTemplate = [
  // Profiles
  { category: 'profile', code: '5045', name: 'Outer Frame Top / Bottom / Verticals (Domal 27)', unit: 'kg/m', weight_kg_per_m: 1.28, rate: 500, active: true },
  { category: 'profile', code: '5047', name: 'Sliding Sash (Domal 27)', unit: 'kg/m', weight_kg_per_m: 0.78, rate: 500, active: true },
  { category: 'profile', code: '5042', name: 'Interlock (Domal 27)', unit: 'kg/m', weight_kg_per_m: 0.35, rate: 500, active: true },
  { category: 'profile', code: '5043', name: 'Mesh Sash (Domal 27)', unit: 'kg/m', weight_kg_per_m: 0.90, rate: 500, active: true },
  { category: 'profile', code: '5008', name: 'Outer Frame Top / Vertical (Fixed Window)', unit: 'kg/m', weight_kg_per_m: 0.60, rate: 500, active: true },
  { category: 'profile', code: '5006', name: 'Mullion (Fixed Window / Vent)', unit: 'kg/m', weight_kg_per_m: 0.68, rate: 500, active: true },
  { category: 'profile', code: '5013', name: 'Glazing Bead (Fixed Window)', unit: 'kg/m', weight_kg_per_m: 0.26, rate: 500, active: true },

  // Glass
  { category: 'glass', code: 'G-5C', name: '5mm Clear', unit: 'sqm', weight_kg_per_m: 0, rate: 600, active: true },
  { category: 'glass', code: 'G-4F', name: '4mm Frosted', unit: 'sqm', weight_kg_per_m: 0, rate: 600, active: true },
  { category: 'glass', code: 'G-6T', name: '6mm Toughened', unit: 'sqm', weight_kg_per_m: 0, rate: 850, active: true },
  { category: 'glass', code: 'G-8TC', name: '8mm Toughened Clear', unit: 'sqm', weight_kg_per_m: 0, rate: 1200, active: true },
  { category: 'glass', code: 'G-6TTB', name: '6mm Toughened Tinted Brown', unit: 'sqm', weight_kg_per_m: 0, rate: 2000, active: true },

  // Mesh
  { category: 'mesh', code: 'M-SS', name: 'SS Mesh', unit: 'sqm', weight_kg_per_m: 0, rate: 290, active: true },

  // Hardware & Handles
  { category: 'hardware', code: 'H-ROL', name: 'Rollers', unit: 'nos', weight_kg_per_m: 0, rate: 30, active: true },
  { category: 'hardware', code: 'H-ROLD', name: 'Sliding Door Heavy Rollers', unit: 'nos', weight_kg_per_m: 0, rate: 80, active: true },
  { category: 'hardware', code: 'H-TL', name: 'Touch Lock', unit: 'nos', weight_kg_per_m: 0, rate: 45, active: true },
  { category: 'hardware', code: 'H-PUH', name: 'Pop-up Handle', unit: 'nos', weight_kg_per_m: 0, rate: 110, active: true },
  { category: 'hardware', code: 'H-CC', name: 'Corner Cleat', unit: 'nos', weight_kg_per_m: 0, rate: 31, active: true },
  { category: 'hardware', code: 'H-STD', name: 'Standard Handle', unit: 'nos', weight_kg_per_m: 0, rate: 0, active: true },
  { category: 'hardware', code: 'H-FLUSH', name: 'Flush Handle', unit: 'nos', weight_kg_per_m: 0, rate: 85, active: true },

  // Gaskets & Seal
  { category: 'gasket', code: 'GSK-SL', name: 'Glazing Gasket for Shutter (Sliding)', unit: 'm', weight_kg_per_m: 0, rate: 12, active: true },
  { category: 'gasket', code: 'GSK-BD', name: 'Gasket for Beads (Fixed / Vent)', unit: 'm', weight_kg_per_m: 0, rate: 10, active: true },
  { category: 'gasket', code: 'BRS-SF', name: 'Brush Seal Shutter Frame', unit: 'm', weight_kg_per_m: 0, rate: 4, active: true },

  // Labour
  { category: 'labour', code: 'LAB-STD', name: 'Standard Fabrication & Fixing Labour', unit: 'sqm', weight_kg_per_m: 0, rate: 500, active: true },
  { category: 'labour', code: 'LAB-FW', name: 'Fixed Window Fabrication & Fixing Labour', unit: 'sqm', weight_kg_per_m: 0, rate: 600, active: true }
];

const seedTemplates = costingEngine.getSeedTemplates();

companyIds.forEach(coId => {
  // 1. Costing Settings
  if (!db.companyCostingSettings[coId]) {
    db.companyCostingSettings[coId] = {
      ...costingEngine.getDefaultCostingSettings(),
      last_changed_by: 'system',
      last_changed_at: new Date().toISOString()
    };
    console.log(`Seeded costing settings for ${coId}`);
  }

  // 2. Materials
  const existingCoMaterials = db.materials.filter(m => m.companyId === coId);
  if (existingCoMaterials.length === 0) {
    defaultMaterialsTemplate.forEach((mat, idx) => {
      db.materials.push({
        id: `mat_${coId}_${idx + 1}`,
        companyId: coId,
        ...mat
      });
    });
    console.log(`Seeded ${defaultMaterialsTemplate.length} materials for ${coId}`);
  }

  // 3. Product Templates
  const existingCoTemplates = db.productTemplates.filter(t => t.companyId === coId);
  if (existingCoTemplates.length === 0) {
    seedTemplates.forEach(tpl => {
      db.productTemplates.push({
        ...tpl,
        id: `${tpl.id}_${coId}`,
        template_key: tpl.id,
        companyId: coId,
        created_at: new Date().toISOString()
      });
    });
    console.log(`Seeded ${seedTemplates.length} templates for ${coId}`);
  }
});

// Write back to quotedesk.json
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log('Successfully updated quotedesk.json with costing data.');
