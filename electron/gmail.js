import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage, shell } from 'electron';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];
const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:4390/oauth2callback';
const DEFAULT_CLIENT_ID = '91065729569-l19g602vsdgjncrf4bsqh5f25brkva1a.apps.googleusercontent.com';
let oauthClient;

function tokenPath() { return path.join(app.getPath('userData'), 'gmail-oauth-token.json'); }
function clientConfig() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID).trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientSecret) throw Error('Add the Google OAuth client secret to your local .env file before connecting Gmail.');
  return { clientId, clientSecret };
}
function saveTokens(tokens) {
  if (!safeStorage.isEncryptionAvailable()) throw Error('Windows secure storage is unavailable.');
  fs.writeFileSync(tokenPath(), JSON.stringify({ encrypted: safeStorage.encryptString(JSON.stringify(tokens)).toString('base64') }), 'utf8');
}
function loadTokens() {
  try {
    const saved = JSON.parse(fs.readFileSync(tokenPath(), 'utf8'));
    return JSON.parse(safeStorage.decryptString(Buffer.from(saved.encrypted, 'base64')));
  } catch { return null; }
}
function makeClient(redirectUri = '') {
  const { clientId, clientSecret } = clientConfig();
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri || undefined);
  const tokens = loadTokens();
  if (tokens) client.setCredentials(tokens);
  client.on('tokens', (next) => { const current = loadTokens() || {}; saveTokens({ ...current, ...next }); });
  oauthClient = client;
  return client;
}
export function gmailStatus() {
  const tokens = loadTokens();
  return { connected: Boolean(tokens?.refresh_token || tokens?.access_token), configured: Boolean(process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID), email: tokens?.email || '' };
}
async function connectGmailFlow() {
  const { clientId, clientSecret } = clientConfig();
  const redirectUri = String(process.env.GOOGLE_REDIRECT_URI || DEFAULT_REDIRECT_URI).trim();
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'http:' || !redirect.hostname || !redirect.port) throw Error('GOOGLE_REDIRECT_URI must be a local HTTP callback such as http://127.0.0.1:4390/oauth2callback.');
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(redirect.port), redirect.hostname, resolve); });
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authUrl = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { server.close(); reject(Error('Gmail authorization timed out.')); }, 5 * 60 * 1000);
    server.on('request', async (request, response) => {
      try {
        const current = new URL(request.url, redirectUri);
        if (current.pathname !== '/oauth2callback') return;
        const error = current.searchParams.get('error');
        const code = current.searchParams.get('code');
        response.writeHead(error ? 400 : 200, { 'Content-Type': 'text/html' });
        response.end(error ? '<h2>PixelPaws Gmail authorization was cancelled.</h2>' : '<h2>Gmail connected. You can close this tab.</h2>');
        clearTimeout(timeout); server.close();
        if (error) return reject(Error('Gmail authorization was cancelled.'));
        const tokenResult = await client.getToken(code);
        client.setCredentials(tokenResult.tokens);
        // The gmail.send scope is intentionally minimal; do not request a profile read.
        saveTokens({ ...tokenResult.tokens });
        resolve({ connected: true, configured: true, email: '' });
      } catch (err) { clearTimeout(timeout); server.close(); reject(err); }
    });
    shell.openExternal(authUrl).catch(reject);
  });
  oauthClient = client;
  return result;
}
let oauthFlow;
export function connectGmail() {
  if (!oauthFlow) oauthFlow = connectGmailFlow().finally(() => { oauthFlow = undefined; });
  return oauthFlow;
}
export function disconnectGmail() { try { fs.rmSync(tokenPath(), { force: true }); } catch {} oauthClient = null; return { connected: false, configured: true, email: '' }; }
export async function sendGmailMessage({ to, subject, text, html }) {
  const tokens = loadTokens();
  if (!tokens) throw Error('Connect Gmail before running an email schedule.');
  const client = oauthClient || makeClient();
  const gmail = google.gmail({ version: 'v1', auth: client });
  const raw = html
    ? (() => {
        const boundary = `PixelPawsBoundary${Date.now()}`;
        return [
          `To: ${to}`,
          `Subject: ${subject}`,
          'MIME-Version: 1.0',
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          '',
          `--${boundary}`,
          'Content-Type: text/plain; charset="UTF-8"',
          'Content-Transfer-Encoding: 8bit',
          '',
          text,
          '',
          `--${boundary}`,
          'Content-Type: text/html; charset="UTF-8"',
          'Content-Transfer-Encoding: 8bit',
          '',
          html,
          '',
          `--${boundary}--`,
        ].join('\r\n');
      })()
    : [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', text].join('\r\n');
  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
}



