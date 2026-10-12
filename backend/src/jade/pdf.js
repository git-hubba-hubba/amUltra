import PDFDocument from 'pdfkit';
import { verifiedWorkers } from './runtime.js';
export function buildPresentation(run, records) {
  const presentation = records.find(record => record.stage === 'presentation');
  if (!presentation) throw new Error('Presentation is unavailable.');
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 48, bufferPages: true,
      info: { Title: presentation.data.title, Author: 'Jade', Subject: run.title } });
    const chunks = []; pdf.on('data', chunk => chunks.push(chunk)); pdf.on('end', () => resolve(Buffer.concat(chunks))); pdf.on('error', reject);
    const heading = title => { pdf.fillColor('#176b4b').font('Helvetica-Bold').fontSize(28).text(title); pdf.moveDown(.7); };
    const body = text => { pdf.fillColor('#25392f').font('Helvetica').fontSize(13).text(text, { lineGap: 5 }); pdf.moveDown(); };
    heading(presentation.data.title); body('AT&T · Call Center · Sales · FirstNet'); body(run.title);
    body(presentation.data.summary); body(`Generated ${new Date(run.finishedAt).toISOString()} · ${run.model}`);
    body('AI-generated analysis grounded in supplied materials. Recommendations and assumptions are distinct from accomplished actions.');
    for (const section of presentation.data.sections) {
      pdf.addPage(); heading(section.title); body(section.narrative); body(`Sources: ${section.sourceIds.join(', ')}`);
    }
    for (const role of ['finance', 'compliance_governance', 'scale']) {
      const record = records.find(entry => entry.stage === role);
      if (!record) continue;
      pdf.addPage(); heading(role === 'compliance_governance' ? 'Compliance & Governance' : role[0].toUpperCase() + role.slice(1));
      body(record.data.summary);
      for (const recommendation of record.data.recommendations) body(`Recommendation: ${recommendation}`);
    }
    pdf.addPage(); heading('Evidence & source trail');
    for (const source of run.sources) body(`${source.sourceId} · ${source.name}\n${source.coverage || 'Supplied source file'}`);
    body(`BUSINESS · ${run.businessContext}`);
    run.clarifications.forEach((entry, index) => body(`HUMAN-${index + 1} · ${entry.text}`));
    const evidenceRecords = [...verifiedWorkers(records), ...verifiedWorkers(records, true), ...records.filter(record => ['finance', 'compliance_governance', 'scale', 'presentation', 'admin_context_check', 'assistant', 'manager'].includes(record.stage))];
    const facts = new Map(evidenceRecords.flatMap(record => record.data.facts).map(fact => [JSON.stringify(fact), fact]));
    for (const fact of facts.values()) body(`${fact.statement}\n${fact.sourceId} · ${fact.locator}\nEvidence: ${fact.evidence}`);
    pdf.addPage(); heading('Limitations & next steps');
    for (const limitation of new Set(records.flatMap(record => record.data.limitations))) body(limitation);
    body(`${run.taskIds.length} user task(s) created in Amethyst. Worker analyses are recorded in Jade; external business actions have not been executed.`);
    const range = pdf.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index++) {
      pdf.switchToPage(index);
      pdf.font('Helvetica').fontSize(9).fillColor('#526b60').text(`Jade  /  ${index + 1} of ${range.count}`, 48, pdf.page.height - 30, { lineBreak: false });
    }
    pdf.end();
  });
}
