'use strict';
const fs = require('fs');

const actualPath = 'd:\\MY website\\MR_Quoter\\quotedesk-server\\quotedesk-server\\public\\index.html';
let html = fs.readFileSync(actualPath, 'utf8');

const oldArray = "['customers', 'products', 'items', 'quotes', 'users', 'companies', 'profiles']";
const newArray = "['customers', 'products', 'items', 'quotes', 'users', 'companies', 'profiles', 'materials', 'productTemplates']";

html = html.split(oldArray).join(newArray);

const oldInit = "db = { settings: { company: init.company || '', accentColor: init.accentColor || '', headerColor: init.headerColor || '', bank: {} }, customers: [], products: [], items: [], quotes: [], users: init.hasUsers ? [{ id: '__placeholder__' }] : [], companies: [], profiles: [], seq: {} };";
const newInit = "db = { settings: { company: init.company || '', accentColor: init.accentColor || '', headerColor: init.headerColor || '', bank: {} }, customers: [], products: [], items: [], quotes: [], users: init.hasUsers ? [{ id: '__placeholder__' }] : [], companies: [], profiles: [], seq: {}, materials: [], productTemplates: [], costingSettings: CostingEngine.getDefaultCostingSettings() };";

html = html.replace(oldInit, newInit);

fs.writeFileSync(actualPath, html, 'utf8');
console.log('Successfully updated DB initialization in index.html!');
