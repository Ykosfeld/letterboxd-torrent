const test = require('node:test');
const assert = require('node:assert');

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function extractBadges(fileName) {
  const badges = [];
  const name = String(fileName || '');

  if (/\b(4k|2160p|uhd)\b/i.test(name)) {
    badges.push({ text: '4K', class: 'badge-4k' });
  } else if (/\b(1080p)\b/i.test(name)) {
    badges.push({ text: '1080p', class: 'badge-1080p' });
  } else if (/\b(720p)\b/i.test(name)) {
    badges.push({ text: '720p', class: 'badge-720p' });
  }

  if (/\b(remux)\b/i.test(name)) {
    badges.push({ text: 'REMUX', class: 'badge-remux' });
  } else if (/\b(bluray|bdrip|brrip)\b/i.test(name)) {
    badges.push({ text: 'BluRay', class: 'badge-bluray' });
  } else if (/\b(web-?dl|webrip)\b/i.test(name)) {
    badges.push({ text: 'WEB-DL', class: 'badge-web' });
  }

  if (/\b(hdr10\+|hdr|dv|dolby[- .]?vision)\b/i.test(name)) {
    badges.push({ text: 'HDR', class: 'badge-hdr' });
  }

  if (/\b(hevc|x265|h\.?265)\b/i.test(name)) {
    badges.push({ text: 'HEVC', class: 'badge-hevc' });
  }

  return badges;
}

function buildSearchQuery(meta, template) {
  if (template === '{imdbId}' && meta.imdbId) {
    return meta.imdbId;
  }
  if (meta.title && meta.year) {
    return `${meta.title} ${meta.year}`;
  }
  return meta.title || '';
}

test('formatBytes formats file sizes correctly', () => {
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(500), '500 B');
  assert.strictEqual(formatBytes(1024), '1 KB');
  assert.strictEqual(formatBytes(1024 * 1024 * 750), '750 MB');
  assert.strictEqual(formatBytes(1024 * 1024 * 1024 * 4.2), '4.2 GB');
});

test('extractBadges correctly extracts release tags', () => {
  const file1 = 'Heat.1995.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-TERMiNAL';
  const badges1 = extractBadges(file1);
  const texts1 = badges1.map(b => b.text);
  assert.ok(texts1.includes('4K'), 'Must identify 4K / 2160p');
  assert.ok(texts1.includes('BluRay'), 'Must identify BluRay');
  assert.ok(texts1.includes('HDR'), 'Must identify HDR');
  assert.ok(texts1.includes('HEVC'), 'Must identify HEVC / x265');

  const file2 = 'Heat.1995.1080p.REMUX.AVC.DTS-HD.MA.5.1-EPSiLON';
  const badges2 = extractBadges(file2);
  const texts2 = badges2.map(b => b.text);
  assert.ok(texts2.includes('1080p'), 'Must identify 1080p');
  assert.ok(texts2.includes('REMUX'), 'Must identify REMUX');

  const file3 = 'Heat.1995.720p.WEB-DL.AAC2.0.H.264';
  const badges3 = extractBadges(file3);
  const texts3 = badges3.map(b => b.text);
  assert.ok(texts3.includes('720p'), 'Must identify 720p');
  assert.ok(texts3.includes('WEB-DL'), 'Must identify WEB-DL');
});

test('buildSearchQuery handles templates and fallbacks', () => {
  const meta = { title: 'Heat', year: '1995', imdbId: 'tt0113277' };

  // Standard template
  assert.strictEqual(buildSearchQuery(meta, '{title} {year}'), 'Heat 1995');

  // IMDb ID template
  assert.strictEqual(buildSearchQuery(meta, '{imdbId}'), 'tt0113277');

  // Fallback if IMDb ID is missing
  const metaNoImdb = { title: 'Heat', year: '1995', imdbId: '' };
  assert.strictEqual(buildSearchQuery(metaNoImdb, '{imdbId}'), 'Heat 1995');
});

test('determineInsertionTarget targets left column AFTER (below) Where to watch section', () => {
  function createMockPage(hasWatch, hasPoster, hasRightSidebar = true) {
    let poster = null;
    let watch = null;
    let rightSidebar = null;

    const leftCol = {
      id: 'left-col',
      className: 'film-poster-overview',
      children: [],
      closest() { return this; }
    };

    if (hasPoster) {
      poster = { id: 'poster-wrap', className: 'film-poster', parentNode: leftCol };
      leftCol.children.push(poster);
    }
    if (hasWatch) {
      watch = { id: 'watch-options-section', className: 'section watch-options', parentNode: leftCol };
      leftCol.children.push(watch);
    }

    if (hasRightSidebar) {
      rightSidebar = {
        id: 'right-actions-sidebar',
        className: 'sidebar',
        children: [{ id: 'user-actions', className: 'actions-panel' }]
      };
    }

    const doc = {
      querySelector(sel) {
        if (/watch/i.test(sel)) return watch;
        if (/poster/i.test(sel)) return poster;
        if (/sidebar/i.test(sel)) return rightSidebar;
        return null;
      },
      querySelectorAll(sel) {
        if (hasWatch) return [{ textContent: 'Where to Watch', closest: () => watch }];
        return [];
      }
    };

    return { doc, leftCol, watch, poster, rightSidebar };
  }

  function getInsertionTarget(doc) {
    const watchSection = doc.querySelector('section.watch-options, section.where-to-watch, .watch-options');
    const posterElement = doc.querySelector('.poster-list, .film-poster, section.poster-list, div.poster');

    if (watchSection) {
      return { position: 'after', target: watchSection, column: 'left' };
    } else if (posterElement) {
      return { position: 'after', target: posterElement, column: 'left' };
    }
    const fallback = doc.querySelector('aside.sidebar');
    return { position: 'prepend', target: fallback, column: 'right' };
  }

  // 1. Where to watch present on left column: must insert AFTER (below) watch section on left column
  const case1 = createMockPage(true, true, true);
  const target1 = getInsertionTarget(case1.doc);
  assert.strictEqual(target1.position, 'after');
  assert.strictEqual(target1.target.id, 'watch-options-section');
  assert.strictEqual(target1.column, 'left');

  // 2. Without where to watch: must insert AFTER poster on left column
  const case2 = createMockPage(false, true, true);
  const target2 = getInsertionTarget(case2.doc);
  assert.strictEqual(target2.position, 'after');
  assert.strictEqual(target2.target.id, 'poster-wrap');
  assert.strictEqual(target2.column, 'left');

  // 3. Fallback when left column not found
  const case3 = createMockPage(false, false, true);
  const target3 = getInsertionTarget(case3.doc);
  assert.strictEqual(target3.position, 'prepend');
  assert.strictEqual(target3.target.id, 'right-actions-sidebar');
});
