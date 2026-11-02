import { chromium } from 'playwright';

async function runAudit() {
  console.log('--- Starting Performance & Accessibility Audit ---');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const startTime = Date.now();
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  const loadTimeMs = Date.now() - startTime;

  // Performance metrics via Performance API
  const metrics = await page.evaluate(() => {
    const timing = performance.getEntriesByType('navigation')[0] || {};
    const paint = performance.getEntriesByType('paint');
    const fcp = paint.find(p => p.name === 'first-contentful-paint');
    return {
      dnsTime: Math.round(timing.domainLookupEnd - timing.domainLookupStart),
      connectTime: Math.round(timing.connectEnd - timing.connectStart),
      ttfb: Math.round(timing.responseStart - timing.requestStart),
      domInteractive: Math.round(timing.domInteractive),
      domComplete: Math.round(timing.domComplete),
      loadEventEnd: Math.round(timing.loadEventEnd),
      fcp: fcp ? Math.round(fcp.startTime) : null
    };
  });

  console.log(`✅ Page Load Time: ${loadTimeMs}ms`);
  console.log(`✅ TTFB: ${metrics.ttfb}ms | FCP: ${metrics.fcp}ms | DOM Interactive: ${metrics.domInteractive}ms`);

  // Accessibility checks
  const a11yAudit = await page.evaluate(() => {
    const issues = [];
    // 1. Missing form labels
    document.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach(input => {
      const id = input.id;
      const hasLabel = id && document.querySelector(`label[for="${id}"]`);
      const parentLabel = input.closest('label');
      const ariaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
      if (!hasLabel && !parentLabel && !ariaLabel) {
        issues.push(`Input #${id || input.name || 'unnamed'} is missing an accessible label`);
      }
    });

    // 2. Images missing alt
    document.querySelectorAll('img').forEach(img => {
      if (!img.hasAttribute('alt')) {
        issues.push(`Image ${img.src.slice(0, 30)} missing alt attribute`);
      }
    });

    // 3. Buttons without text/aria-label
    document.querySelectorAll('button').forEach(btn => {
      const text = btn.innerText.trim();
      const ariaLabel = btn.getAttribute('aria-label') || btn.getAttribute('title');
      if (!text && !ariaLabel) {
        issues.push('Button with empty content and no aria-label');
      }
    });

    return issues;
  });

  console.log(`Accessibility check found ${a11yAudit.length} potential issues:`);
  a11yAudit.slice(0, 10).forEach(iss => console.log(' - ' + iss));

  await browser.close();
  console.log('--- Performance & Accessibility Audit Completed Successfully ---');
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
