'use client';
import { useState } from 'react';
import { Field, FormPanel, Table, s, useLoad, type Api } from './ui';

type User = { id: number; username: string; display_name: string; active: number; roles: string | null };
const ROLE_NAMES: Record<string, string> = { ADMIN: 'ผู้ดูแลระบบ', STAFF: 'เจ้าหน้าที่' };
export function Users({ api, selfId }: { api: Api; selfId: number }) {
  const { data, error, busy, reload } = useLoad<User[]>(api, 'users');
  const [creating, setCreating] = useState(false), [message, setMessage] = useState('');
  return <>
    <div className="section-head"><div><h2>บัญชีผู้ใช้</h2><p className="muted">เจ้าหน้าที่ดูนัด กดส่งแจ้งเตือน และบันทึกงดส่งได้ · ผู้ดูแลระบบตั้งค่าคลินิกและการแจ้งเตือนได้</p></div><button className="primary" onClick={() => setCreating(true)}>เพิ่มบัญชี</button></div>
    {creating && <FormPanel title="เพิ่มบัญชีผู้ใช้" onClose={() => setCreating(false)} onSubmit={async f => {
      await api('users', 'POST', { username: f.get('username'), displayName: f.get('displayName'), password: f.get('password'), role: f.get('role') }); reload(); }}>
      <Field label="ชื่อผู้ใช้" name="username" required autoComplete="off"/>
      <Field label="ชื่อที่แสดง" name="displayName" required/>
      <Field label="รหัสผ่าน (อย่างน้อย 12 อักขระ)" name="password" type="password" minLength={12} required autoComplete="new-password"/>
      <label>บทบาท<select name="role" defaultValue="STAFF"><option value="STAFF">เจ้าหน้าที่</option><option value="ADMIN">ผู้ดูแลระบบ</option></select></label>
    </FormPanel>}
    {message && <p role="alert" className="error">{message}</p>}
    {error && <div role="alert" className="error">{error}</div>}
    <div className="surface" aria-busy={busy}><Table headers={['ชื่อผู้ใช้', 'ชื่อที่แสดง', 'บทบาท', 'สถานะ', '']} empty={!data?.length}>
      {data?.map(u => <tr key={u.id}><td>{u.username}</td><td>{u.display_name}</td><td>{s(u.roles).split(',').filter(Boolean).map(r => ROLE_NAMES[r] ?? r).join(', ') || '—'}</td>
        <td><span className="badge">{u.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
        <td>{u.id !== selfId && <button onClick={async () => { setMessage(''); try { await api(`users/${u.id}`, 'PATCH', { active: !u.active }); reload(); } catch (e) { setMessage(e instanceof Error ? e.message : 'บันทึกไม่ได้'); } }}>{u.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>}</td></tr>)}
    </Table></div>
    <p className="helper">ลืมรหัสผ่าน: ผู้ดูแล server ใช้คำสั่ง npm run db:reset-password</p>
  </>;
}

type Audit = { id: number; action: string; entity_type: string; entity_id: string | null; changes: unknown; created_at: string; actor: string | null };
export function AuditLog({ api }: { api: Api }) {
  const { data, error, busy } = useLoad<Audit[]>(api, 'audit');
  return <><div className="section-head"><div><h2>ประวัติการใช้งาน</h2><p className="muted">200 เหตุการณ์ล่าสุด · เวลา UTC</p></div></div>
    {error && <div role="alert" className="error">{error}</div>}
    <div className="surface" aria-busy={busy}><Table headers={['เวลา UTC', 'ผู้ดำเนินการ', 'การกระทำ', 'รายการอ้างอิง', 'รายละเอียด']} empty={!data?.length}>
      {data?.map(a => <tr key={a.id}><td>{s(a.created_at)}</td><td>{s(a.actor) || 'Worker'}</td><td>{a.action}</td><td>{a.entity_type} #{s(a.entity_id)}</td><td className="audit-detail">{typeof a.changes === 'string' ? a.changes : JSON.stringify(a.changes)}</td></tr>)}
    </Table></div></>;
}
