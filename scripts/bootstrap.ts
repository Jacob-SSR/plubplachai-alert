import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, rows, execute, transaction } from '../src/server/db';
import { ensure } from '../src/domain/validation';

export const grants:Record<string,string[]>={
 ADMIN:['appointment.read','notification.read','notification.send','notification.manage','clinic.manage','optout.manage','audit.read','user.manage'],
 // Front-desk / clinic staff: see appointments, resend one notice, record patients who opt out.
 STAFF:['appointment.read','notification.read','notification.send','optout.manage'],
};
export async function bootstrap(username:string|undefined,password:string|undefined) {
  ensure(username && /^[A-Za-z0-9_.-]{3,100}$/.test(username),'ตั้ง ADMIN_USERNAME ให้ถูกต้อง');
  ensure(password && password.length>=12 && Buffer.byteLength(password)<=72,'ตั้ง ADMIN_PASSWORD อย่างน้อย 12 อักขระ ไม่เกิน 72 bytes');
  const hash=await bcrypt.hash(password,12);
  await transaction(async db=>{
    for(const [role,permissions] of Object.entries(grants)) {
      await execute('INSERT IGNORE INTO roles(code) VALUES(?)',[role],db);
      for(const permission of permissions) {
        await execute('INSERT IGNORE INTO permissions(code) VALUES(?)',[permission],db);
        await execute('INSERT IGNORE INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r,permissions p WHERE r.code=? AND p.code=?',[role,permission],db);
      }
    }
    const existing=await rows('SELECT id FROM users WHERE username=?',[username],db);
    if(!existing.length) {
      const result=await execute('INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)',[username,'ผู้ดูแลระบบ',hash],db);
      await execute("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE code='ADMIN'",[result.insertId],db);
    }
  });
}
if(process.argv[1]?.endsWith('bootstrap.ts')) bootstrap(process.env.ADMIN_USERNAME?.trim(),process.env.ADMIN_PASSWORD)
  .then(()=>console.log('Bootstrap completed. Existing passwords and roles were not overwritten.'))
  .catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool().end());
