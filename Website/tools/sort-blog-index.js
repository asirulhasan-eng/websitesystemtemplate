#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const blogIndexPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '../blog/index.html');

const marker = '          <!-- ADD NEW BLOG CARDS ABOVE THIS LINE -->';
const firstCardNeedle = '\n          <div class="blog-card reveal">';
const cardStartPattern = /^          <div class="blog-card reveal">/m;

function parsePublishDate(card) {
  const match = card.match(/<div class="blog-card__meta">\s*<span>[^<]*<\/span>\s*&bull;\s*([^<\r\n]+)/s);
  if (!match) return { time: 0, label: '' };
  const label = match[1].trim();
  const time = Date.parse(label);
  return { time: Number.isNaN(time) ? 0 : time, label };
}

function sortBlogIndex(html) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Blog index marker not found: ${marker}`);
  }

  const exampleEnd = html.indexOf('\n          -->');
  const searchFrom = exampleEnd === -1 ? 0 : exampleEnd + '\n          -->'.length;
  const firstCardIndex = html.indexOf(firstCardNeedle, searchFrom);
  if (firstCardIndex === -1 || firstCardIndex >= markerIndex) {
    return { html, count: 0, changed: false, firstLabel: '', lastLabel: '' };
  }

  const cardsStart = firstCardIndex + 1;
  const cardsEnd = html.lastIndexOf('\n', markerIndex);
  const before = html.slice(0, cardsStart);
  const cardsText = html.slice(cardsStart, cardsEnd).trimEnd();
  const after = html.slice(cardsEnd);

  const cards = cardsText
    .split(/\n(?=          <div class="blog-card reveal">)/)
    .map((card, index) => ({ card: card.trimEnd(), index, ...parsePublishDate(card) }))
    .filter((entry) => cardStartPattern.test(entry.card));

  if (cards.length === 0) {
    return { html, count: 0, changed: false, firstLabel: '', lastLabel: '' };
  }

  const missingDates = cards.filter((entry) => !entry.time).map((entry) => entry.index + 1);
  if (missingDates.length) {
    throw new Error(`Blog card(s) missing parseable publish dates: ${missingDates.join(', ')}`);
  }

  const sorted = [...cards].sort((a, b) => {
    if (b.time !== a.time) return b.time - a.time;
    return a.index - b.index;
  });

  return {
    html: `${before}${sorted.map((entry) => entry.card).join('\n\n')}${after}`,
    count: cards.length,
    changed: sorted.some((entry, sortedIndex) => entry.index !== sortedIndex),
    firstLabel: sorted[0].label,
    lastLabel: sorted[sorted.length - 1].label,
  };
}

if (require.main === module) {
  if (!fs.existsSync(blogIndexPath)) {
    throw new Error(`Blog index not found: ${blogIndexPath}`);
  }
  const html = fs.readFileSync(blogIndexPath, 'utf8');
  const result = sortBlogIndex(html);
  fs.writeFileSync(blogIndexPath, result.html, 'utf8');
  console.log(JSON.stringify({
    ok: true,
    path: blogIndexPath,
    cards: result.count,
    changed: result.changed,
    firstDate: result.firstLabel,
    lastDate: result.lastLabel,
  }, null, 2));
}

module.exports = { sortBlogIndex, parsePublishDate };
