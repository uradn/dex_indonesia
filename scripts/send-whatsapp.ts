/**
 * One-shot WhatsApp sender. Connects with saved creds, sends message to self, disconnects.
 * Usage: bun run scripts/send-whatsapp.ts "message text"
 *        bun run scripts/send-whatsapp.ts --file /path/to/message.txt
 */
import { createWaSocket, waitForWaConnection } from '../src/gateway/channels/whatsapp/session.js';
import { dexterPath } from '../src/utils/paths.js';
import { readFileSync } from 'node:fs';

const AUTH_DIR = dexterPath('credentials', 'whatsapp', 'default');

const args = process.argv.slice(2);
let body: string;

if (args[0] === '--file' && args[1]) {
  body = readFileSync(args[1], 'utf-8');
} else if (args[0]) {
  body = args.join(' ');
} else {
  console.error('Usage: bun run scripts/send-whatsapp.ts "message" OR --file /path/to/msg.txt');
  process.exit(1);
}

const sock = await createWaSocket({ authDir: AUTH_DIR, printQr: false });

try {
  await waitForWaConnection(sock);

  // Self-chat JID: own phone number @s.whatsapp.net (strip device suffix)
  const selfJid = sock.user?.id?.replace(/:\d+@/, '@') ?? '';
  if (!selfJid) throw new Error('Could not determine own JID from credentials');

  const result = await sock.sendMessage(selfJid, { text: body });
  console.log(`Sent to ${selfJid} — id: ${result?.key?.id}`);
} finally {
  setTimeout(() => { try { sock.ws.close(); } catch { /* ignore */ } }, 800);
}
