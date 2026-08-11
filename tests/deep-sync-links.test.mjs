import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectPriorityDetailLinks,
  isPriorityDetailLink,
} from '../src/core/deep-sync-links.js';

test('visit detail links require an actual visit identifier', () => {
  assert.equal(
    isPriorityDetailLink({
      text: 'Non-discrimination',
      href: 'https://mychart.example.org/mychart/app/visits/past-details?mode=stdfile&option=nondiscriminationcredena',
    }, 'visits'),
    false,
  );

  assert.equal(
    isPriorityDetailLink({
      text: 'Notes from Care Team',
      href: 'https://mychart.example.org/mychart/app/visits/past-details?csn=abc&pageMode=notesfirst',
    }, 'visits'),
    true,
  );

  assert.equal(
    isPriorityDetailLink({
      text: 'Print this page in a printer-friendly format',
      href: 'https://mychart.example.org/mychart/Visits#',
    }, 'visits'),
    false,
  );
});

test('collectPriorityDetailLinks deduplicates and keeps nested note URLs', () => {
  const links = collectPriorityDetailLinks({
    links: [
      {
        text: 'Clinical Notes',
        href: 'https://mychart.example.org/mychart/app/visits/note?csn=abc&noteid=one',
      },
      {
        text: 'Clinical Notes',
        href: 'https://mychart.example.org/mychart/app/visits/note?csn=abc&noteid=one',
      },
      {
        text: 'Terms and Conditions',
        href: 'https://mychart.example.org/mychart/app/visits/past-details?mode=stdfile&option=terms',
      },
    ],
  }, { category: 'visits' });

  assert.deepEqual(links, [
    'https://mychart.example.org/mychart/app/visits/note?csn=abc&noteid=one',
  ]);
});

test('collectPriorityDetailLinks keeps Epic visit note links with note document identifiers', () => {
  const links = collectPriorityDetailLinks({
    links: [
      {
        text: 'Notes from Care Team',
        href: 'https://mychart.example.org/mychart/app/visits/note?hnoID=note-123&hnoDAT=20260430&lrpID=visit-456',
      },
      {
        text: 'Visit summary',
        href: 'https://mychart.example.org/mychart/app/visits/past-details?mode=stdfile&option=terms',
      },
    ],
  }, { category: 'visits' });

  assert.deepEqual(links, [
    'https://mychart.example.org/mychart/app/visits/note?hnoID=note-123&hnoDAT=20260430&lrpID=visit-456',
  ]);
});

test('collectPriorityDetailLinks keeps more than the first twelve visit note links', () => {
  const links = Array.from({ length: 16 }, (_, index) => ({
    text: 'Clinical Notes',
    href: `https://mychart.example.org/mychart/app/visits/note?csn=visit-${index}`,
  }));

  assert.equal(
    collectPriorityDetailLinks({ links }, { category: 'visits' }).length,
    16,
  );
});

test('collectPriorityDetailLinks keeps legacy MyChart test-result component links', () => {
  const links = collectPriorityDetailLinks({
    links: [
      {
        text: 'CBC W/DIFFERENTIAL',
        href: 'https://mychart.example.org/mychart/Clinical/TestResults?component=abc',
      },
      {
        text: 'Test Results',
        href: 'https://mychart.example.org/mychart/Clinical/TestResults',
      },
      {
        text: 'Past result details',
        href: 'https://mychart.example.org/mychart/app/test-results/past-result-details?component=abc',
      },
    ],
  }, { category: 'test-results' });

  assert.deepEqual(links, [
    'https://mychart.example.org/mychart/Clinical/TestResults?component=abc',
  ]);
});

test('collectPriorityDetailLinks keeps same-route MyChart test-result detail links with identifiers', () => {
  const links = collectPriorityDetailLinks({
    links: [
      {
        text: 'CBC W/DIFFERENTIAL',
        href: 'https://mychart.example.org/mychart/app/test-results?pageMode=1&eorderid=abc',
      },
      {
        text: 'Test Results List',
        href: 'https://mychart.example.org/mychart/app/test-results',
      },
      {
        text: 'Result category',
        href: 'https://mychart.example.org/mychart/app/test-results?category=lab',
      },
    ],
  }, { category: 'test-results' });

  assert.deepEqual(links, [
    'https://mychart.example.org/mychart/app/test-results?pageMode=1&eorderid=abc',
  ]);
});
