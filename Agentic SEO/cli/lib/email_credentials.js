function normalizeGmailAppPassword(password, host) {
  const value = String(password || '');
  const hostname = String(host || '').toLowerCase();
  if (!hostname.includes('gmail.com')) return value;

  // Google shows app passwords as four 4-character groups. SMTP/IMAP
  // authentication expects the 16-character token; tolerate copied spaces.
  const withoutSpaces = value.replace(/[ \t]/g, '');
  if (/^[A-Za-z0-9]{16}$/.test(withoutSpaces)) return withoutSpaces;
  return value;
}

function smtpCredentials(config) {
  const host = config.require('SMTP_HOST');
  return {
    host,
    port: Number(config.get('SMTP_PORT', 587)),
    secure: String(config.get('SMTP_USE_TLS', 'true')).toLowerCase() === 'ssl',
    user: config.require('SMTP_USER'),
    pass: normalizeGmailAppPassword(config.require('SMTP_PASS'), host),
    from: config.get('EMAIL_FROM', config.require('SMTP_USER')),
    fromName: config.get('EMAIL_FROM_NAME', '{{SITE_NAME}} Agent'),
  };
}

function imapCredentials(config) {
  const host = config.get('IMAP_HOST', 'imap.gmail.com');
  return {
    host,
    port: Number(config.get('IMAP_PORT', 993)),
    user: config.get('IMAP_USER', config.require('SMTP_USER')),
    pass: normalizeGmailAppPassword(config.get('IMAP_PASS', config.require('SMTP_PASS')), host),
  };
}

module.exports = {
  normalizeGmailAppPassword,
  smtpCredentials,
  imapCredentials,
};
