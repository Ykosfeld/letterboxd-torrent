const test = require('node:test');
const assert = require('node:assert');

function processSearchResults(rawResults, maxResults) {
  // 1. Sort descending by nbSeeders
  rawResults.sort((a, b) => (b.nbSeeders || 0) - (a.nbSeeders || 0));

  // 2. Take top N
  const topN = rawResults.slice(0, Number(maxResults) || 5);

  // 3. Map strictly sanitized safe fields
  return topN.map(item => ({
    fileName: String(item.fileName || ''),
    fileSize: Number(item.fileSize || 0),
    nbSeeders: Number(item.nbSeeders || 0),
    nbLeechers: Number(item.nbLeechers || 0),
    fileUrl: String(item.fileUrl || ''),
    descrLink: String(item.descrLink || ''),
    siteUrl: String(item.siteUrl || ''),
  }));
}

test('processSearchResults sorts by nbSeeders descending and limits to N', () => {
  const mockApiResults = [
    { fileName: 'Movie.720p', nbSeeders: 10, nbLeechers: 2, fileSize: 1000, fileUrl: 'magnet:?xt=1' },
    { fileName: 'Movie.1080p', nbSeeders: 150, nbLeechers: 20, fileSize: 3000, fileUrl: 'magnet:?xt=2' },
    { fileName: 'Movie.2160p', nbSeeders: 45, nbLeechers: 5, fileSize: 8000, fileUrl: 'magnet:?xt=3' },
    { fileName: 'Movie.CAM', nbSeeders: 2, nbLeechers: 1, fileSize: 500, fileUrl: 'magnet:?xt=4' },
    { fileName: 'Movie.REMUX', nbSeeders: 80, nbLeechers: 10, fileSize: 12000, fileUrl: 'magnet:?xt=5' },
    { fileName: 'Movie.WEB', nbSeeders: 30, nbLeechers: 4, fileSize: 2000, fileUrl: 'magnet:?xt=6' },
  ];

  const processed = processSearchResults(mockApiResults, 3);

  assert.strictEqual(processed.length, 3);
  // Highest seeders should be first
  assert.strictEqual(processed[0].fileName, 'Movie.1080p');
  assert.strictEqual(processed[0].nbSeeders, 150);

  // Second highest
  assert.strictEqual(processed[1].fileName, 'Movie.REMUX');
  assert.strictEqual(processed[1].nbSeeders, 80);

  // Third highest
  assert.strictEqual(processed[2].fileName, 'Movie.2160p');
  assert.strictEqual(processed[2].nbSeeders, 45);
});

test('processSearchResults sanitizes non-string/corrupted inputs', () => {
  const corruptedItem = [
    {
      fileName: null,
      nbSeeders: 'not-a-number',
      nbLeechers: undefined,
      fileSize: '5000',
      fileUrl: 12345,
      extraMaliciousProperty: '<script>alert(1)</script>',
    },
  ];

  const result = processSearchResults(corruptedItem, 5);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(typeof result[0].fileName, 'string');
  assert.strictEqual(result[0].fileName, '');
  assert.strictEqual(typeof result[0].fileUrl, 'string');
  assert.strictEqual(result[0].fileUrl, '12345');
  assert.strictEqual(result[0].extraMaliciousProperty, undefined);
});
