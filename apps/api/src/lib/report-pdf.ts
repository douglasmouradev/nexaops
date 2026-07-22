import PDFDocument from 'pdfkit';
import type { Response } from 'express';

export function streamReportPdf(
  res: Response,
  opts: {
    title: string;
    organizationName?: string;
    lines: { label: string; value: string }[];
    tables?: { title: string; headers: string[]; rows: string[][] }[];
  }
): void {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${opts.title.replace(/\s+/g, '-').toLowerCase()}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).text('NexaOps', { continued: false });
  doc.fontSize(14).fillColor('#333').text(opts.title);
  if (opts.organizationName) {
    doc.fontSize(10).fillColor('#666').text(opts.organizationName);
  }
  doc.moveDown();
  doc.fontSize(9).fillColor('#999').text(`Gerado em ${new Date().toLocaleString('pt-BR')}`);
  doc.moveDown();

  doc.fillColor('#000').fontSize(11);
  for (const line of opts.lines) {
    doc.text(`${line.label}: ${line.value}`);
  }

  if (opts.tables) {
    for (const table of opts.tables) {
      doc.moveDown().fontSize(12).text(table.title);
      doc.moveDown(0.5).fontSize(10);
      doc.text(table.headers.join(' | '));
      for (const row of table.rows) {
        doc.text(row.join(' | '));
      }
    }
  }

  doc.end();
}
