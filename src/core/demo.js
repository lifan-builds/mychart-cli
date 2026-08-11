import { buildRecordsAgentJsonlExport } from './record-exports.js';

const GENERATED_AT = '2026-01-15T12:00:00.000Z';

export function buildSyntheticDemo() {
  const patient = { key: 'synthetic-demo-patient', label: 'Synthetic Demo Patient' };
  const records = [
    {
      id: 'synthetic-result-1',
      patient,
      category: 'test-results',
      recordType: 'test-result',
      title: 'Synthetic Lab Panel',
      date: '2026-01-15',
      rawText: 'Synthetic example only. Sample value: 7.2 units.',
      sourceUrl: 'https://mychart.example.org/mychart/app/test-results/details?synthetic=1',
      extractedAt: GENERATED_AT,
    },
    {
      id: 'synthetic-visit-1',
      patient,
      category: 'visits',
      recordType: 'visit-note',
      title: 'Synthetic Follow-up Note',
      date: '2026-01-14',
      clinicalText: 'Synthetic example only. The care plan was reviewed.',
      rawText: 'Synthetic example only. The care plan was reviewed.',
      sourceUrl: 'https://mychart.example.org/mychart/app/visits/note?synthetic=1',
      extractedAt: GENERATED_AT,
    },
  ];
  const cards = records.map((record) => ({
    id: record.id,
    patient: record.patient,
    category: record.category,
    recordType: record.recordType,
    title: record.title,
    date: record.date,
    sourceUrl: record.sourceUrl,
  }));
  const exported = buildRecordsAgentJsonlExport({
    cards,
    records,
    all: true,
    generatedAt: GENERATED_AT,
    filters: { demo: true },
  });

  return {
    records,
    cards,
    jsonl: exported.content,
    recordCount: exported.exportedCards.length,
    chunkCount: exported.chunkLines.length,
  };
}

export function formatSyntheticDemo() {
  const demo = buildSyntheticDemo();
  return [
    'mychart-cli synthetic demo',
    'No network, login, browser profile, or patient data is used.',
    '',
    `Records: ${demo.recordCount}`,
    `JSONL chunks: ${demo.chunkCount}`,
    ...demo.cards.map((card) => `${card.date}\t${card.category}\t${card.title}`),
    '',
    'JSONL preview:',
    demo.jsonl,
  ].join('\n');
}
