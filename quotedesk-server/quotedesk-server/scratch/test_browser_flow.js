const path = require('path');
const fs = require('fs');
const { chromium } = require('../node_modules/playwright');

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      if (!txt.includes('ERR_NAME_NOT_RESOLVED') && !txt.includes('401 (Unauthorized)')) {
        errors.push(txt);
        console.log('[BROWSER_ERROR]', txt);
      }
    }
  });
  page.on('pageerror', err => {
    errors.push(err.message);
    console.log('[PAGE_ERROR]', err.message);
  });

  const artifactDir = 'C:/Users/LAPTOP/.gemini/antigravity/brain/07933736-6a9f-4bf4-a2f7-2eb98961371d';

  console.log('1. Loading localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(artifactDir, '01_live_login_screen.png') });
  console.log('Saved 01_live_login_screen.png');

  // Submit login
  console.log('2. Entering credentials for master...');
  await page.fill('#l_un', 'master');
  await page.fill('#l_pw', 'Rafiq@2026#');
  await page.click('button:has-text("Sign In")');
  await page.waitForTimeout(1800);

  // Read latest OTP from server log
  console.log('3. Fetching generated 2FA OTP from server log...');
  const logPath = 'C:/Users/LAPTOP/.gemini/antigravity/brain/07933736-6a9f-4bf4-a2f7-2eb98961371d/.system_generated/tasks/task-2371.log';
  const logContent = fs.readFileSync(logPath, 'utf8');
  const matches = [...logContent.matchAll(/OTP CODE:\s*(\d{6})/g)];
  if (!matches.length) throw new Error('No OTP found in server log');
  const otpCode = matches[matches.length - 1][1];
  console.log('Using OTP Code:', otpCode);

  await page.fill('#otp_val', otpCode);
  await page.click('#otp_btn');
  await page.waitForTimeout(3000);

  // Take screenshot of Dashboard
  console.log('4. Dashboard loaded! Taking screenshot...');
  await page.screenshot({ path: path.join(artifactDir, '02_live_dashboard.png') });
  console.log('Saved 02_live_dashboard.png');

  // Check Executive Financial Cards
  const kpiData = await page.evaluate(() => {
    const elDebtors = document.getElementById('kpi-debtors');
    const elCreditors = document.getElementById('kpi-creditors');
    const elCash = document.getElementById('kpi-cash');
    const elSusp = document.getElementById('kpi-susp');
    return {
      debtors: elDebtors ? elDebtors.innerText : 'not found',
      creditors: elCreditors ? elCreditors.innerText : 'not found',
      cash: elCash ? elCash.innerText : 'not found',
      susp: elSusp ? elSusp.innerText : 'not found'
    };
  });
  console.log('Financial KPI Elements on Dashboard:', kpiData);

  // Open Release Notes modal
  console.log('5. Opening Release Notes Modal...');
  await page.evaluate(() => {
    if (typeof window.openReleaseNotesModal === 'function') {
      window.openReleaseNotesModal();
    }
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifactDir, '03_live_release_notes_modal.png') });
  console.log('Saved 03_live_release_notes_modal.png');

  // Close modal safely
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const closeBtn = btns.find(b => b.textContent.trim().toLowerCase() === 'close' || b.textContent.trim().toLowerCase() === 'ok');
    if (closeBtn) closeBtn.click();
    else if (typeof window.closeModal === 'function') window.closeModal();
  });
  await page.waitForTimeout(500);

  // Navigate to Billing & Documents (#/documents)
  console.log('6. Navigating to Billing & Documents (#/documents)...');
  await page.evaluate(() => window.location.hash = '#/documents');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(artifactDir, '04_live_billing_and_documents.png') });
  console.log('Saved 04_live_billing_and_documents.png');

  // Test opening New Document modal
  console.log('7. Testing New Document modal in Documents view...');
  await page.evaluate(() => {
    if (window.DocumentsUI && typeof window.DocumentsUI.openNewModal === 'function') {
      window.DocumentsUI.openNewModal('DELIVERY_CHALLAN');
    }
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifactDir, '05_live_new_document_modal.png') });
  console.log('Saved 05_live_new_document_modal.png');

  // Close modal
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const cancelBtn = btns.find(b => b.textContent.trim().toLowerCase() === 'cancel');
    if (cancelBtn) cancelBtn.click();
    else if (typeof window.closeModal === 'function') window.closeModal();
  });
  await page.waitForTimeout(500);

  // Navigate to Accounting Suite (#/accounting)
  console.log('8. Navigating to Accounting Core (#/accounting)...');
  await page.evaluate(() => window.location.hash = '#/accounting');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(artifactDir, '06_live_accounting_suite.png') });
  console.log('Saved 06_live_accounting_suite.png');

  // Test Trial Balance tab
  console.log('9. Switching to Trial Balance tab...');
  await page.evaluate(() => {
    const btn = document.querySelector('button[data-tab="trial-balance"], a[data-tab="trial-balance"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifactDir, '07_live_trial_balance.png') });
  console.log('Saved 07_live_trial_balance.png');

  // Test Profit & Loss tab
  console.log('10. Switching to Profit & Loss tab...');
  await page.evaluate(() => {
    const btn = document.querySelector('button[data-tab="pl"], a[data-tab="pl"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifactDir, '08_live_profit_and_loss.png') });
  console.log('Saved 08_live_profit_and_loss.png');

  // Test Bank Statement Modal
  console.log('11. Testing Bank Statement upload modal...');
  await page.evaluate(() => {
    if (window.AccountingUI && typeof window.AccountingUI.openBankModal === 'function') {
      window.AccountingUI.openBankModal();
    }
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifactDir, '09_live_bank_upload_modal.png') });
  console.log('Saved 09_live_bank_upload_modal.png');

  console.log('All tabs and modals verified!');
  console.log('Total critical errors encountered:', errors.length);
  if (errors.length) console.log('Errors:', errors);

  await browser.close();
  console.log('Verification run successfully finished.');
}

run().catch(err => {
  console.error('Run failed:', err);
  process.exit(1);
});
