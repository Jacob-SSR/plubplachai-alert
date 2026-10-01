'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Stethoscope, Bell, UserX, ShieldCheck, History, LogOut, LayoutDashboard, FileBarChart } from 'lucide-react';
import type { Actor } from '@/src/server/auth';
import { HospitalLogo } from './hospital-logo';
import { Overview } from './overview';
import { Appointments } from './appointments';
import { Reports } from './reports';
import { Clinics } from './clinics';
import { Notifications } from './notifications';
import { OptOuts } from './opt-outs';
import { Users, AuditLog } from './users';
import { type Api } from './ui';

const nav = [
  { key: 'overview', title: 'ภาพรวม', icon: LayoutDashboard, permission: 'appointment.read' },
  { key: 'appointments', title: 'นัดหมายจาก HOSxP', icon: CalendarDays, permission: 'appointment.read' },
  { key: 'reports', title: 'รายงาน', icon: FileBarChart, permission: 'appointment.read' },
  { key: 'clinics', title: 'คลินิก', icon: Stethoscope, permission: 'clinic.manage' },
  { key: 'notifications', title: 'แจ้งเตือน', icon: Bell, permission: 'notification.read' },
  { key: 'opt-outs', title: 'งดส่งรายคน', icon: UserX, permission: 'optout.manage' },
  { key: 'users', title: 'บัญชีผู้ใช้', icon: ShieldCheck, permission: 'user.manage' },
  { key: 'audit', title: 'ประวัติการใช้งาน', icon: History, permission: 'audit.read' },
];
export function Workspace({ actor }: { actor: Actor }) {
  const router = useRouter();
  const allowed = nav.filter(v => actor.permissions.includes(v.permission));
  const [tab, setTab] = useState(allowed[0]?.key ?? 'overview'), [error, setError] = useState('');
  const can = (p: string) => actor.permissions.includes(p);
  const api: Api = useCallback(async (path, method = 'GET', body) => {
    const r = await fetch(`/api/v1/${path}`, { method, cache: 'no-store', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'x-csrf-token': actor.csrf }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (r.status === 401) { router.replace('/login'); router.refresh(); throw Error('กรุณาเข้าสู่ระบบใหม่'); }
    const b = await r.json();
    if (!r.ok) throw Error(b.message + (b.fieldErrors ? ': ' + b.fieldErrors.map((v: { field: string; message: string }) => `${v.field} ${v.message}`).join(' · ') : ''));
    return b;
  }, [actor.csrf, router]);
  const admin = actor.roles.includes('ADMIN');
  return <div className="app-shell"><a className="skip-link" href="#main">ข้ามไปเนื้อหา</a>
    <aside className="sidebar"><div className="brand"><HospitalLogo/><div>พลับพลาชัย<small>แจ้งเตือนนัดผู้ป่วย</small></div></div>
      <p className="nav-caption">พื้นที่ทำงาน</p>
      <nav aria-label="เมนูหลัก">{allowed.map(v => <button key={v.key} aria-current={tab === v.key ? 'page' : undefined} onClick={() => { setTab(v.key); setError(''); }}><v.icon size={19}/>{v.title}</button>)}</nav>
      <div className="sidebar-footer"><div className="avatar">{actor.displayName.slice(0, 1)}</div><div><strong>{actor.displayName}</strong><small>{admin ? 'ผู้ดูแลระบบ' : 'เจ้าหน้าที่'}</small></div>
        <button aria-label="ออกจากระบบ" onClick={async () => { try { await api('auth/logout', 'POST', {}); router.replace('/login'); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'ออกจากระบบไม่ได้'); } }}><LogOut size={18}/></button></div>
    </aside>
    <div className="main-wrap"><header className="topbar"><div><span className="eyebrow">โรงพยาบาลพลับพลาชัย</span><h1>แจ้งเตือนนัดหมายผู้ป่วยทุกคลินิก</h1></div></header>
      <main id="main" className="content">
        {error && <div role="alert" className="error">{error}</div>}
        {tab === 'overview' && <Overview api={api} go={setTab}/>}
        {tab === 'appointments' && <Appointments api={api} canSend={can('notification.send')}/>}
        {tab === 'reports' && <Reports api={api}/>}
        {tab === 'clinics' && <Clinics api={api}/>}
        {tab === 'notifications' && <Notifications api={api} canManage={can('notification.manage')}/>}
        {tab === 'opt-outs' && <OptOuts api={api}/>}
        {tab === 'users' && <Users api={api} selfId={actor.id}/>}
        {tab === 'audit' && <AuditLog api={api}/>}
      </main>
      <footer className="page-footer">ระบบแจ้งเตือนนัดผู้ป่วย · โรงพยาบาลพลับพลาชัย <span>ข้อมูลผู้ป่วยสำหรับผู้มีสิทธิ์ใช้งานเท่านั้น</span></footer>
    </div></div>;
}
