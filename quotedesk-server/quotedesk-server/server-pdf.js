/**
 * MR_Quoter — Enterprise Server-Side PDF Generator
 * Built with PDFKit & QRCode — Native vector rendering, embedded typography, scannable online QR code
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

function formatCurrency(num) {
  const n = Number(num || 0);
  return '₹ ' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatDate(dStr) {
  if (!dStr) return '-';
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return String(dStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
  } catch (e) {
    return String(dStr);
  }
}

/**
 * Generate a high-resolution, multi-page vector PDF buffer for a quotation
 * @param {Object} quote - Quotation object
 * @param {Object} settings - Company settings
 * @param {String} publicUrl - Public link for QR code (e.g. https://mr-quoter.onrender.com/q/<token>)
 * @returns {Promise<Buffer>}
 */
async function generateQuotationPdf(quote, settings = {}, publicUrl = '') {
  const q = quote || {};
  const s = settings || {};
  const c = q.cust || {};
  const b = s.bank || {};

  // Pre-generate QR code if public URL is available
  let qrImageBuffer = null;
  const qrTarget = publicUrl || (q.shareToken ? `https://mr-quoter.onrender.com/q/${q.shareToken}` : '');
  if (qrTarget) {
    try {
      qrImageBuffer = await QRCode.toBuffer(qrTarget, {
        width: 160,
        margin: 1,
        color: { dark: '#1e3a8a', light: '#ffffff' }
      });
    } catch (e) {
      console.warn('[PDF Generator] QR code creation warning:', e.message);
    }
  }

  return new Promise((resolve, reject) => {
    try {
      // Calculate totals
      let subtotal = 0;
      const lines = (q.lines || []).map((l, idx) => {
        if (l.type === 'section') return { ...l, isSec: true };
        const qty = parseFloat(l.qty) || 1;
        let amt = 0, billedArea = 0;
        if (l.type === 'boq') {
          const rate = parseFloat(l.rate) || 0;
          let gross = qty * rate;
          const disc = parseFloat(l.disc) || 0;
          amt = Math.max(0, gross - (gross * disc / 100));
          subtotal += amt;
          return { ...l, amt, rate, qty, idx: idx + 1 };
        }
        const w = parseFloat(l.w) || 0, h = parseFloat(l.h) || 0;
        const area = (w / 304.8) * (h / 304.8);
        const minArea = parseFloat(l.minArea) || 0;
        billedArea = Math.max(area, minArea);
        const rate = parseFloat(l.rate) || 0;
        const hw = parseFloat(l.hw) || 0;
        let gross = (billedArea * rate + hw) * qty;
        const disc = parseFloat(l.disc) || 0;
        amt = Math.max(0, gross - (gross * disc / 100));
        subtotal += amt;
        return { ...l, amt, rate, qty, billedArea, totalArea: billedArea * qty, idx: idx + 1 };
      });

      let discount = 0;
      if (q.discVal) {
        if (q.discType === 'flat') discount = parseFloat(q.discVal) || 0;
        else discount = subtotal * (parseFloat(q.discVal) || 0) / 100;
      }
      const extras = (q.extras || []).reduce((acc, ex) => acc + (parseFloat(ex.amount) || 0), 0);
      const taxable = Math.max(0, subtotal - discount + extras);
      const gstRate = q.gst ? (parseFloat(q.gstRate) || 18) : 0;
      const gstAmt = q.gst ? Math.round(taxable * gstRate / 100) : 0;
      const grandTotal = Math.round(taxable + gstAmt);

      // Create PDFKit document: A4 (595.28 x 841.89 pt) with 36pt (0.5 in) margins
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 36, bottom: 45, left: 36, right: 36 },
        bufferPages: true,
        autoFirstPage: true
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', err => reject(err));

      // Register bundled TrueType font for Rupee (₹) & Unicode support
      const regularFontPath = path.join(__dirname, 'fonts', 'regular.ttf');
      const boldFontPath = path.join(__dirname, 'fonts', 'bold.ttf');
      let fontReg = 'Helvetica';
      let fontBold = 'Helvetica-Bold';
      let fontOblique = 'Helvetica-Oblique';

      if (fs.existsSync(regularFontPath) && fs.existsSync(boldFontPath)) {
        try {
          doc.registerFont('AppFont', regularFontPath);
          doc.registerFont('AppFontBold', boldFontPath);
          fontReg = 'AppFont';
          fontBold = 'AppFontBold';
          fontOblique = 'AppFont';
        } catch (e) {
          console.warn('[PDF Generator] Font register fallback to Helvetica:', e.message);
        }
      }

      const pageWidth = doc.page.width; // 595.28
      const pageHeight = doc.page.height; // 841.89
      const leftMargin = 36;
      const rightMargin = pageWidth - 36; // 559.28
      const contentWidth = rightMargin - leftMargin; // 523.28

      const primaryColor = '#1e3a8a'; // Deep blue
      const secondaryColor = '#475569';
      const textColor = '#0f172a';
      const borderColor = '#cbd5e1';
      const headerBg = '#f8fafc';

      // 1. Draw Top Header Bar
      function drawHeader(isFirstPage = true) {
        const topY = doc.y;

        // Monogram / Logo Badge
        const companyName = s.company || 'MR_Quoter';
        const initial = companyName.slice(0, 1).toUpperCase();

        doc.roundedRect(leftMargin, topY, 40, 40, 6)
           .fillAndStroke(primaryColor, primaryColor);
        doc.font(fontBold).fontSize(18).fillColor('#ffffff')
           .text(initial, leftMargin, topY + 9, { width: 40, align: 'center' });

        // Company Name & Info
        doc.fontSize(15).font(fontBold).fillColor(primaryColor);
        doc.text(companyName, leftMargin + 48, topY, { width: 280 });

        if (s.tagline) {
          doc.fontSize(8.5).font(fontOblique).fillColor(secondaryColor);
          doc.text(s.tagline, leftMargin + 48, doc.y + 2, { width: 280 });
        }

        const addressParts = [
          [s.address1, s.address2].filter(Boolean).join(', '),
          [s.city, s.state && (s.state + (s.pincode ? ' - ' + s.pincode : ''))].filter(Boolean).join(', '),
          [s.phone && 'Ph: ' + s.phone, s.email && 'Email: ' + s.email].filter(Boolean).join(' | '),
          s.gstin ? 'GSTIN: ' + s.gstin : null
        ].filter(Boolean);

        doc.fontSize(7.8).font(fontReg).fillColor(secondaryColor);
        addressParts.forEach(line => {
          doc.text(line, leftMargin + 48, doc.y + 1, { width: 280 });
        });

        // Right side: QUOTATION Info Box (plus QR code on page 1)
        const metaBoxWidth = qrImageBuffer && isFirstPage ? 200 : 160;
        const metaBoxX = rightMargin - metaBoxWidth;
        const metaBoxY = topY;

        doc.roundedRect(metaBoxX, metaBoxY, metaBoxWidth, 76, 4)
           .fillAndStroke('#f1f5f9', '#cbd5e1');

        if (qrImageBuffer && isFirstPage) {
          // Embed live scannable QR Code
          try {
            doc.image(qrImageBuffer, metaBoxX + 6, metaBoxY + 8, { width: 60, height: 60 });
            doc.font(fontReg).fontSize(6.5).fillColor(primaryColor)
               .text('Scan to View Online', metaBoxX + 2, metaBoxY + 68, { width: 68, align: 'center' });
          } catch (e) {}

          const metaTextX = metaBoxX + 74;
          doc.fontSize(9.5).font(fontBold).fillColor(primaryColor);
          doc.text('ESTIMATE / QUOTE', metaTextX, metaBoxY + 6, { width: 120 });

          doc.fontSize(7.5).font(fontReg).fillColor(textColor);
          const metaY = metaBoxY + 20;
          doc.font(fontBold).text('Quote #:', metaTextX, metaY);
          doc.font(fontReg).text(q.no || 'DRAFT', metaTextX + 42, metaY, { width: 80 });

          doc.font(fontBold).text('Date:', metaTextX, metaY + 11);
          doc.font(fontReg).text(formatDate(q.date), metaTextX + 42, metaY + 11);

          doc.font(fontBold).text('Validity:', metaTextX, metaY + 22);
          doc.font(fontReg).text(q.validUntil ? formatDate(q.validUntil) : (q.validity ? q.validity + ' Days' : '30 Days'), metaTextX + 42, metaY + 22);

          if (q.rev) {
            doc.font(fontBold).text('Revision:', metaTextX, metaY + 33);
            doc.font(fontReg).text('Rev ' + q.rev, metaTextX + 42, metaY + 33);
          }
        } else {
          doc.fontSize(10.5).font(fontBold).fillColor(primaryColor);
          doc.text('ESTIMATE / QUOTE', metaBoxX + 6, metaBoxY + 6, { width: metaBoxWidth - 12, align: 'center' });

          doc.fontSize(8).font(fontReg).fillColor(textColor);
          const metaY = metaBoxY + 22;
          doc.font(fontBold).text('Quote No:', metaBoxX + 8, metaY);
          doc.font(fontReg).text(q.no || 'DRAFT', metaBoxX + 56, metaY, { width: 95 });

          doc.font(fontBold).text('Date:', metaBoxX + 8, metaY + 12);
          doc.font(fontReg).text(formatDate(q.date), metaBoxX + 56, metaY + 12);

          doc.font(fontBold).text('Valid Until:', metaBoxX + 8, metaY + 24);
          doc.font(fontReg).text(q.validUntil ? formatDate(q.validUntil) : (q.validity ? q.validity + ' Days' : '30 Days'), metaBoxX + 56, metaY + 24);

          if (q.rev) {
            doc.font(fontBold).text('Revision:', metaBoxX + 8, metaY + 36);
            doc.font(fontReg).text('Rev ' + q.rev, metaBoxX + 56, metaY + 36);
          }
        }

        // Move cursor below header
        doc.y = Math.max(doc.y + 12, metaBoxY + 84);

        // Divider line
        doc.moveTo(leftMargin, doc.y).lineTo(rightMargin, doc.y).strokeColor(borderColor).lineWidth(1).stroke();
        doc.y += 10;
      }

      drawHeader(true);

      // 2. Client Details & Project Summary Box
      const clientY = doc.y;
      doc.roundedRect(leftMargin, clientY, contentWidth, 52, 4)
         .fillAndStroke(headerBg, borderColor);

      // Left Column: Customer details
      doc.font(fontBold).fontSize(8.5).fillColor(primaryColor)
         .text('QUOTATION FOR (CLIENT):', leftMargin + 10, clientY + 7);

      doc.font(fontBold).fontSize(9.5).fillColor(textColor)
         .text(c.name || '(Walk-in Customer)', leftMargin + 10, clientY + 19, { width: 260 });

      const custDetails = [
        c.contact && 'Attn: ' + c.contact,
        [c.phone, c.email].filter(Boolean).join(' | '),
        c.gstin && 'GSTIN: ' + c.gstin
      ].filter(Boolean).join('  •  ');

      if (custDetails) {
        doc.font(fontReg).fontSize(8).fillColor(secondaryColor)
           .text(custDetails, leftMargin + 10, clientY + 32, { width: 290 });
      }

      // Right Column: Project & Sales details
      doc.font(fontBold).fontSize(8.5).fillColor(primaryColor)
         .text('PROJECT / SITE DETAILS:', leftMargin + 310, clientY + 7);

      doc.font(fontReg).fontSize(8.5).fillColor(textColor)
         .text(q.project || 'Architectural Glazing & Fabrication', leftMargin + 310, clientY + 19, { width: 200 });

      const projMeta = [
        c.city ? 'City: ' + c.city : null,
        q.dimUnit ? 'Unit: ' + q.dimUnit.toUpperCase() : null
      ].filter(Boolean).join('  |  ');

      if (projMeta) {
        doc.font(fontReg).fontSize(8).fillColor(secondaryColor)
           .text(projMeta, leftMargin + 310, clientY + 32, { width: 200 });
      }

      doc.y = clientY + 62;

      // 3. Itemized Table
      const colWidths = {
        idx: 26,
        desc: 227,
        size: 75,
        qty: 45,
        rate: 70,
        amt: 80
      };

      const colX = {
        idx: leftMargin,
        desc: leftMargin + colWidths.idx,
        size: leftMargin + colWidths.idx + colWidths.desc,
        qty: leftMargin + colWidths.idx + colWidths.desc + colWidths.size,
        rate: leftMargin + colWidths.idx + colWidths.desc + colWidths.size + colWidths.qty,
        amt: leftMargin + colWidths.idx + colWidths.desc + colWidths.size + colWidths.qty + colWidths.rate
      };

      function drawTableHeader(y) {
        doc.rect(leftMargin, y, contentWidth, 20).fillAndStroke(primaryColor, primaryColor);
        doc.fontSize(8).font(fontBold).fillColor('#ffffff');

        doc.text('#', colX.idx + 4, y + 6, { width: colWidths.idx - 6, align: 'center' });
        doc.text('DESCRIPTION / SPECIFICATIONS', colX.desc + 6, y + 6, { width: colWidths.desc - 10 });
        doc.text('SIZE (W×H)', colX.size, y + 6, { width: colWidths.size - 6, align: 'right' });
        doc.text('QTY', colX.qty, y + 6, { width: colWidths.qty - 6, align: 'right' });
        doc.text('RATE', colX.rate, y + 6, { width: colWidths.rate - 6, align: 'right' });
        doc.text('AMOUNT', colX.amt, y + 6, { width: colWidths.amt - 8, align: 'right' });

        return y + 20;
      }

      let curY = drawTableHeader(doc.y);

      let itemCounter = 0;
      lines.forEach(l => {
        // Section Header
        if (l.isSec) {
          if (curY > pageHeight - 90) {
            doc.addPage();
            drawHeader(false);
            curY = drawTableHeader(doc.y);
          }
          doc.rect(leftMargin, curY, contentWidth, 18).fillAndStroke('#e2e8f0', '#cbd5e1');
          doc.font(fontBold).fontSize(8.5).fillColor(primaryColor)
             .text(l.title || 'SECTION', leftMargin + 8, curY + 5, { width: contentWidth - 16 });
          curY += 18;
          return;
        }

        itemCounter++;
        const isSize = l.type === 'size';

        // Prepare description text
        const titleText = l.name || (isSize ? 'Window / Door System' : 'Item');
        const specDetails = [
          (l.tag || l.loc) ? `Mark: ${[l.tag, l.loc].filter(Boolean).join(' - ')}` : null,
          l.spec ? l.spec : null,
          [l.glassName && 'Glass: ' + l.glassName, l.finishName && 'Finish: ' + l.finishName].filter(Boolean).join('; ')
        ].filter(Boolean).join('\n');

        // Estimate row height
        doc.font(fontReg).fontSize(7.5);
        const specHeight = specDetails ? doc.heightOfString(specDetails, { width: colWidths.desc - 12 }) : 0;
        const rowHeight = Math.max(22, 14 + specHeight);

        // Check page overflow
        if (curY + rowHeight > pageHeight - 80) {
          doc.addPage();
          drawHeader(false);
          curY = drawTableHeader(doc.y);
        }

        // Alternate zebra shading
        if (itemCounter % 2 === 0) {
          doc.rect(leftMargin, curY, contentWidth, rowHeight).fill('#f8fafc');
        }

        // Row border
        doc.rect(leftMargin, curY, contentWidth, rowHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

        // Print row values
        doc.fontSize(8).fillColor(textColor);

        // Index
        doc.font(fontReg).text(String(itemCounter), colX.idx + 2, curY + 5, { width: colWidths.idx - 4, align: 'center' });

        // Description
        doc.font(fontBold).text(titleText, colX.desc + 6, curY + 5, { width: colWidths.desc - 12 });
        if (specDetails) {
          doc.font(fontReg).fontSize(7.5).fillColor(secondaryColor)
             .text(specDetails, colX.desc + 6, curY + 16, { width: colWidths.desc - 12 });
        }

        // Size
        doc.font(fontReg).fontSize(8).fillColor(textColor);
        const sizeText = isSize && l.w && l.h ? `${l.w} × ${l.h}` : '-';
        doc.text(sizeText, colX.size, curY + 5, { width: colWidths.size - 6, align: 'right' });

        // Qty
        const qtyText = `${l.qty || 1} ${l.unit || (isSize ? 'nos' : '')}`;
        doc.text(qtyText, colX.qty, curY + 5, { width: colWidths.qty - 6, align: 'right' });

        // Rate
        const rateText = formatCurrency(l.rate || 0);
        doc.text(rateText, colX.rate, curY + 5, { width: colWidths.rate - 6, align: 'right' });

        // Amount
        doc.font(fontBold);
        const amtText = formatCurrency(l.amt || 0);
        doc.text(amtText, colX.amt, curY + 5, { width: colWidths.amt - 8, align: 'right' });

        curY += rowHeight;
      });

      // 4. Totals & Commercial Breakdown Section
      if (curY > pageHeight - 165) {
        doc.addPage();
        drawHeader(false);
        curY = doc.y;
      } else {
        curY += 8;
      }

      const totalsBoxWidth = 230;
      const totalsBoxX = rightMargin - totalsBoxWidth;
      const leftColWidth = contentWidth - totalsBoxWidth - 16;

      // Draw Totals Box
      let totY = curY;
      doc.roundedRect(totalsBoxX, totY, totalsBoxWidth, 104, 4).fillAndStroke('#f8fafc', borderColor);

      function printTotalLine(label, val, isBold = false, isHighlight = false) {
        if (isHighlight) {
          doc.rect(totalsBoxX + 1, totY + 1, totalsBoxWidth - 2, 22).fill('#e0f2fe');
        }
        doc.font(isBold ? fontBold : fontReg)
           .fontSize(isBold ? 9.5 : 8.5)
           .fillColor(isHighlight ? primaryColor : textColor);
        doc.text(label, totalsBoxX + 10, totY + 6);
        doc.text(val, totalsBoxX + 80, totY + 6, { width: totalsBoxWidth - 90, align: 'right' });
        totY += 20;
      }

      printTotalLine('Subtotal:', formatCurrency(subtotal));
      if (discount > 0) {
        printTotalLine('Discount:', '- ' + formatCurrency(discount));
      }
      if (extras > 0) {
        printTotalLine('Other Charges:', '+ ' + formatCurrency(extras));
      }
      if (q.gst) {
        printTotalLine(`GST (${gstRate}%):`, formatCurrency(gstAmt));
      }
      printTotalLine('GRAND TOTAL:', formatCurrency(grandTotal), true, true);

      // Left Column: Payment Terms & Bank Info
      let leftY = curY;

      // Payment Terms
      if ((q.pay || []).length) {
        doc.font(fontBold).fontSize(8.5).fillColor(primaryColor)
           .text('PAYMENT MILESTONES / STAGES:', leftMargin, leftY);
        leftY += 12;

        q.pay.filter(p => p.label || p.pct).forEach(p => {
          const pAmt = Math.round(grandTotal * (parseFloat(p.pct) || 0) / 100);
          doc.font(fontReg).fontSize(8).fillColor(textColor)
             .text(`• ${p.label || 'Stage'}: ${p.pct}% (${formatCurrency(pAmt)})`, leftMargin + 6, leftY, { width: leftColWidth });
          leftY += 11;
        });
        leftY += 4;
      }

      // Bank Details
      if (b && (b.acct || b.bank)) {
        doc.font(fontBold).fontSize(8.5).fillColor(primaryColor)
           .text('BANK TRANSFER DETAILS:', leftMargin, leftY);
        leftY += 12;
        const bankLines = [
          b.name ? 'Account Name: ' + b.name : null,
          b.bank ? 'Bank: ' + b.bank : null,
          b.acct ? 'Account No: ' + b.acct : null,
          b.ifsc ? 'IFSC Code: ' + b.ifsc : null,
          b.branch ? 'Branch: ' + b.branch : null
        ].filter(Boolean).join(' | ');

        doc.font(fontReg).fontSize(8).fillColor(secondaryColor)
           .text(bankLines, leftMargin + 6, leftY, { width: leftColWidth });
        leftY += 18;
      }

      curY = Math.max(totY + 12, leftY + 12);

      // 5. Terms & Conditions and Signature Section
      if (curY > pageHeight - 110) {
        doc.addPage();
        drawHeader(false);
        curY = doc.y;
      }

      // Terms Box
      const termsText = (q.terms || '').trim() || 'Prices are valid for the quotation validity period.\nStandard warranty applies as per manufacturer terms.\nInstallation and delivery schedules confirmed upon receipt of advance.';
      doc.font(fontBold).fontSize(8.5).fillColor(primaryColor)
         .text('TERMS & CONDITIONS:', leftMargin, curY);
      curY += 12;

      doc.font(fontReg).fontSize(7.5).fillColor(secondaryColor)
         .text(termsText, leftMargin + 6, curY, { width: contentWidth - 170 });

      // Authorized Signatory
      const signX = rightMargin - 150;
      doc.moveTo(signX, curY + 36).lineTo(rightMargin, curY + 36).strokeColor(borderColor).stroke();
      doc.font(fontBold).fontSize(8.5).fillColor(textColor)
         .text(s.company || 'Authorized Signatory', signX, curY + 40, { width: 150, align: 'center' });
      doc.font(fontReg).fontSize(7.5).fillColor(secondaryColor)
         .text('Authorized Signatory', signX, curY + 52, { width: 150, align: 'center' });

      // 6. Footer: Page numbering on all pages
      const pageRange = doc.bufferedPageRange();
      for (let i = 0; i < pageRange.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(7.5).font(fontReg).fillColor(secondaryColor);
        doc.text(
          `Page ${i + 1} of ${pageRange.count}  •  ${q.no || 'Quotation'}  •  Generated by ${s.company || 'MR_Quoter'}`,
          leftMargin,
          pageHeight - 28,
          { width: contentWidth, align: 'center' }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateQuotationPdf,
  formatCurrency,
  formatDate
};
