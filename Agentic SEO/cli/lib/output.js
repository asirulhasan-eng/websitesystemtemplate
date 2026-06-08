/**
 * output.js — Unified output formatter for v2 CLI
 *
 * Supports JSON, table, and CSV output formats.
 * Every CLI command uses this to render results consistently.
 */

function formatOutput(data, format = 'json', options = {}) {
  switch (format) {
    case 'csv': return formatCsv(data, options);
    case 'table': return formatTable(data, options);
    case 'json':
    default: return formatJson(data, options);
  }
}

function printOutput(data, format = 'json', options = {}) {
  console.log(formatOutput(data, format, options));
}

function formatJson(data, options = {}) {
  const indent = options.compact ? 0 : 2;
  return JSON.stringify(data, null, indent);
}

function formatCsv(data, options = {}) {
  const rows = Array.isArray(data) ? data : (data.rows || data.results || [data]);
  if (rows.length === 0) return '';

  const headers = options.fields
    ? options.fields
    : Object.keys(rows[0]).filter(k => typeof rows[0][k] !== 'object');

  const csvEscape = (value) => {
    const str = value === null || value === undefined ? '' : String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
}

function formatTable(data, options = {}) {
  const rows = Array.isArray(data) ? data : (data.rows || data.results || [data]);
  if (rows.length === 0) return '(no results)';

  const headers = options.fields
    ? options.fields
    : Object.keys(rows[0]).filter(k => {
        const val = rows[0][k];
        return val === null || val === undefined || typeof val !== 'object';
      });

  // Calculate column widths
  const widths = {};
  for (const h of headers) {
    widths[h] = h.length;
  }
  for (const row of rows) {
    for (const h of headers) {
      const val = row[h] === null || row[h] === undefined ? '' : String(row[h]);
      widths[h] = Math.min(60, Math.max(widths[h], val.length));
    }
  }

  // Build table
  const pad = (str, width) => {
    const s = str === null || str === undefined ? '' : String(str);
    return s.length > width ? s.slice(0, width - 1) + '…' : s.padEnd(width);
  };

  const headerLine = headers.map(h => pad(h.toUpperCase(), widths[h])).join('  ');
  const separator = headers.map(h => '─'.repeat(widths[h])).join('──');

  const lines = [headerLine, separator];
  for (const row of rows) {
    lines.push(headers.map(h => pad(row[h], widths[h])).join('  '));
  }

  if (options.showCount !== false) {
    lines.push(separator);
    lines.push(`${rows.length} row(s)`);
  }

  return lines.join('\n');
}

/**
 * Wrap a command result with standard envelope for JSON output.
 */
function envelope(data, meta = {}) {
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    tool: meta.tool || 'v2',
    ...data,
  };
}

/**
 * Wrap an error into standard JSON envelope.
 */
function errorEnvelope(error, meta = {}) {
  return {
    ok: false,
    generated_at: new Date().toISOString(),
    tool: meta.tool || 'v2',
    error: error instanceof Error ? error.message : String(error),
  };
}

module.exports = {
  formatOutput,
  printOutput,
  formatJson,
  formatCsv,
  formatTable,
  envelope,
  errorEnvelope,
};
