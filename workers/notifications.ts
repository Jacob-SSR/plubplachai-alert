import 'dotenv/config';
import { pool, execute } from '../src/server/db';
import { dispatchOne, scheduleReminders } from '../src/server/notifications';
import { recordSyncError, syncAppointments, syncClinics } from '../src/server/sync';
import { closeHosxpPool } from '../src/server/hosxp';

let stopping = false;
process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const errorCode = (e: unknown) => e && typeof e === 'object' && 'code' in e ? e.code : 'WORKER_ERROR';
// Reading every clinic's appointments is heavier than health-check's four rooms, so HOSxP is read every
// HOSXP_SYNC_INTERVAL_SECONDS (default 120) while sending keeps going in between.
const syncEvery = Math.max(30, Number(process.env.HOSXP_SYNC_INTERVAL_SECONDS) || 120) * 1000;
// Pause between two messages so a morning of reminders does not flood the MOPH API.
const sendGap = Math.max(100, Number(process.env.MOPH_SEND_INTERVAL_MS) || 500);
let lastSync = 0, lastClinics = 0;

async function tick() {
  if (Date.now() - lastSync >= syncEvery) {
    lastSync = Date.now();
    try {
      if (Date.now() - lastClinics >= 6 * 3600_000) { await syncClinics(); lastClinics = Date.now(); }
      const r = await syncAppointments();
      if (r.queued) console.log(`Sync: read ${r.read}, queued ${r.queued}`);
    } catch (e) { console.error('HOSxP sync failed:', errorCode(e)); await recordSyncError(e).catch(() => {}); }
  }
  await scheduleReminders();
  for (let n = 0; n < 300 && !stopping; n++) { if (!await dispatchOne()) break; await sleep(sendGap); }
  await execute('DELETE FROM user_sessions WHERE expires_at<UTC_TIMESTAMP()');
  await execute('DELETE FROM login_limits WHERE reset_at<UTC_TIMESTAMP()');
}
async function main() {
  do {
    try { await tick(); } catch (e) { console.error('Notification worker failed:', errorCode(e)); if (process.argv.includes('--once')) process.exitCode = 1; }
    if (process.argv.includes('--once')) break;
    for (let i = 0; i < 15 && !stopping; i++) await sleep(1000);
  } while (!stopping);
  await pool().end(); await closeHosxpPool();
}
void main();
