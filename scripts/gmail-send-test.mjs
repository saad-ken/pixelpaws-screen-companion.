import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const credentialsPath = path.join(root, 'google-oauth-client.json');
const to = process.argv[2] || process.env.GMAIL_TO;
const subject = process.argv[3] || 'PixelPaws Gmail OAuth test';
const body = process.argv.slice(4).join(' ') || 'This is a test message sent by PixelPaws through Gmail OAuth.';
const scopes = ['https://www.googleapis.com/auth/gmail.send'];

if (!to) {
  console.error('Usage: npm run gmail:test -- recipient@example.com "Subject" "Message body"');
  process.exit(1);
}
if (!fs.existsSync(credentialsPath)) {
  console.error('Missing google-oauth-client.json. Download a Desktop OAuth client JSON from Google Cloud and place it in the project root.');
  process.exit(1);
}

const auth = await authenticate({ keyfilePath: credentialsPath, scopes, port: 0 });
const gmail = google.gmail({ version: 'v1', auth });
const raw = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n');
const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
console.log(`Email sent to ${to}.`);
