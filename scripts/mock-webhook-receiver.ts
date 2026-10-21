import { MockReceiver } from './lib/mockReceiver';

const port = Number(process.env['RECEIVER_PORT'] ?? 4000);
const receiver = new MockReceiver(process.env['WEBHOOK_SECRET'] === undefined ? {} : { secret: process.env['WEBHOOK_SECRET'] });

const actual = await receiver.listen(port);
console.log(`mock webhook receiver listening on http://127.0.0.1:${actual}`);
console.log('  POST /hook[/any/path]     receives TaskHub events (signature checked when WEBHOOK_SECRET is set)');
console.log('  POST /admin/mode          {"path":"/hook","mode":"ok|fail-n|always-500|slow|drop","failCount":2,"delayMs":3000}');
console.log('  GET  /admin/received      list received webhooks (duplicates are flagged)');
console.log('  DELETE /admin/received    clear the list');

const stop = (): void => void receiver.close().then(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
