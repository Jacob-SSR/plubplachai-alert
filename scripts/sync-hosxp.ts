import 'dotenv/config';
import { closeHosxpPool } from '../src/server/hosxp';
import { syncAppointments, syncClinics } from '../src/server/sync';
import { closePool } from '../src/server/db';

async function main() {
  const clinics = await syncClinics();
  const appointments = await syncAppointments();
  console.log(JSON.stringify({ clinics, appointments }));
}
main().catch(error => {
  console.error(error?.code ?? 'HOSXP_SYNC_FAILED'); process.exitCode = 1;
}).finally(async () => { await closePool(); await closeHosxpPool(); });
