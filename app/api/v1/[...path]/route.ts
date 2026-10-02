import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, login, logout, requirePermission } from '@/src/server/auth';
import { rows, execute, transaction } from '@/src/server/db';
import { jsonBody, errorResponse } from '@/src/server/http';
import { clock, ensure, id, text } from '@/src/domain/validation';
import { audit } from '@/src/server/audit';
import { notificationSettings, retryNotification, sendManualNotification, sendTestNotification } from '@/src/server/notifications';
import { addOptOut, createUser, listAppointments, listClinics, listNotifications, listOptOuts, listUsers, overview, removeOptOut, setUserActive, updateClinic } from '@/src/server/admin';
import { syncClinics } from '@/src/server/sync';
import { appointmentReport } from '@/src/server/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await params).path, route = path.join('/'), method = req.method, url = req.nextUrl.searchParams;
    if (route === 'auth/login' && method === 'POST') { const data = z.object({ username: text(100), password: z.string().min(1).max(200) }).parse(await jsonBody(req)); return await login(req, data.username, data.password); }
    const actor = await authenticate(req), allow = (permission: string) => requirePermission(actor, permission);
    let result: unknown;
    if (route === 'me' && method === 'GET') result = actor;
    else if (route === 'auth/logout' && method === 'POST') return await logout(req, actor);
    else if (route === 'overview' && method === 'GET') { allow('appointment.read'); result = await overview(); }
    else if (route === 'appointments' && method === 'GET') { allow('appointment.read'); result = await listAppointments(url); }
    else if (route === 'reports' && method === 'GET') { allow('appointment.read'); result = await appointmentReport(url); }
    else if (route === 'clinics' && method === 'GET') { allow('appointment.read'); result = await listClinics(); }
    else if (route === 'clinics/sync' && method === 'POST') { allow('clinic.manage'); result = { count: await syncClinics() }; }
    else if (path[0] === 'clinics' && path.length === 2 && method === 'PATCH') { allow('clinic.manage'); result = await updateClinic(z.string().max(20).parse(path[1]), await jsonBody(req), actor); }
    else if (route === 'opt-outs' && method === 'GET') { allow('optout.manage'); result = await listOptOuts(); }
    else if (route === 'opt-outs' && method === 'POST') { allow('optout.manage'); result = await addOptOut(await jsonBody(req), actor); }
    else if (path[0] === 'opt-outs' && path.length === 3 && path[2] === 'remove' && method === 'POST') { allow('optout.manage'); result = await removeOptOut(path[1], actor); }
    else if (route === 'notification-settings' && method === 'GET') { allow('notification.read'); result = await notificationSettings(); }
    else if (route === 'notification-settings' && method === 'PATCH') {
      allow('notification.manage');
      const input = z.object({ enabled: z.boolean(), mode: z.enum(['DRY_RUN', 'LIVE']), version: id, notifyNew: z.boolean(), notifyCancel: z.boolean(),
        reminderTime: clock, windowStart: clock, windowEnd: clock, days: z.array(z.number().int().min(0).max(30)).max(3), confirmLive: z.boolean().default(false), showBrand: z.boolean().default(true) }).parse(await jsonBody(req));
      ensure(input.windowStart < input.windowEnd, 'เวลาเริ่มส่งต้องก่อนเวลาหยุดส่ง');
      if (input.enabled && input.mode === 'LIVE') ensure(input.confirmLive && process.env.MOPH_LIVE_ENABLED === 'true' && process.env.MOPH_CLIENT_KEY && process.env.MOPH_SECRET_KEY, 'ต้องยืนยันเปิดส่งจริงและตั้งค่าฝั่ง server ครบก่อน');
      result = await transaction(async db => {
        const r = await execute('UPDATE notification_settings SET enabled=?,mode=?,notify_new=?,notify_cancel=?,reminder_time=?,window_start=?,window_end=?,show_brand=?,version=version+1 WHERE id=1 AND version=?',
          [input.enabled, input.mode, input.notifyNew, input.notifyCancel, input.reminderTime, input.windowStart, input.windowEnd, input.showBrand, input.version], db);
        ensure(r.affectedRows, 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
        await execute('UPDATE notification_rules SET active=0', [], db);
        for (const day of new Set(input.days)) await execute('INSERT INTO notification_rules(days_before,active) VALUES(?,1) ON DUPLICATE KEY UPDATE active=1', [day], db);
        await execute("UPDATE notification_jobs j JOIN notification_rules r ON r.id=j.rule_id SET j.status='CANCELLED',j.safe_error='RULE_DISABLED' WHERE r.active=0 AND j.status='PENDING'", [], db);
        await audit(db, actor.id, 'SETTINGS', 'notification_settings', 1, { enabled: input.enabled, mode: input.mode, notifyNew: input.notifyNew, notifyCancel: input.notifyCancel,
          reminderTime: input.reminderTime, window: `${input.windowStart}-${input.windowEnd}`, days: input.days, showBrand: input.showBrand });
        return { ok: true };
      });
    }
    else if (route === 'notifications' && method === 'GET') { allow('notification.read'); result = await listNotifications(url); }
    else if (path[0] === 'notifications' && path[2] === 'retry' && method === 'POST') { allow('notification.manage'); const input = z.object({ reason: text(500), acknowledgeUnknown: z.boolean().default(false) }).parse(await jsonBody(req)); result = await retryNotification(z.uuid().parse(path[1]), input.reason, input.acknowledgeUnknown, actor); }
    else if (route === 'notifications/manual' && method === 'POST') { allow('notification.send'); const input = z.object({ oappId: z.string().trim().regex(/^\d{1,20}$/) }).parse(await jsonBody(req)); result = await sendManualNotification(input.oappId, actor); }
    else if (route === 'notifications/test' && method === 'POST') { allow('notification.manage'); const input = z.object({ cid: z.string().trim() }).parse(await jsonBody(req)); result = await sendTestNotification(input.cid, actor); }
    else if (route === 'audit' && method === 'GET') { allow('audit.read'); result = await rows('SELECT a.id,a.action,a.entity_type,a.entity_id,a.changes,a.created_at,u.display_name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.id DESC LIMIT 200'); }
    else if (route === 'users' && method === 'GET') { allow('user.manage'); result = await listUsers(); }
    else if (route === 'users' && method === 'POST') { allow('user.manage'); result = await createUser(await jsonBody(req), actor); }
    else if (path[0] === 'users' && path.length === 2 && method === 'PATCH') { allow('user.manage'); result = await setUserActive(id.parse(path[1]), await jsonBody(req), actor); }
    else ensure(false, 'ไม่พบ API', 404, 'NOT_FOUND');
    const response = NextResponse.json(result); response.headers.set('Cache-Control', 'no-store'); return response;
  } catch (error) { const response = errorResponse(error); response.headers.set('Cache-Control', 'no-store'); return response; }
}
export { handle as GET, handle as POST, handle as PATCH };
