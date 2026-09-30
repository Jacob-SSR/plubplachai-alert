'use client';
import { useState } from 'react';
import { FormPanel, Table, n, s, useLoad, type Api } from './ui';

type Clinic = { code: string; name: string; enabled: number; note: string; in_source: number; version: number; upcoming: number };
export function Clinics({ api }: { api: Api }) {
  const { data, error, busy, reload } = useLoad<Clinic[]>(api, 'clinics');
  const [editing, setEditing] = useState<Clinic>(), [busyCode, setBusyCode] = useState(''), [message, setMessage] = useState('');
  async function toggle(c: Clinic) {
    setBusyCode(c.code); setMessage('');
    try { await api(`clinics/${encodeURIComponent(c.code)}`, 'PATCH', { enabled: !c.enabled, note: c.note, version: c.version }); reload(); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'บันทึกไม่ได้'); } finally { setBusyCode(''); }
  }
  return <>
    <div className="section-head"><div><h2>คลินิก</h2><p className="muted">เลือกคลินิกที่ต้องการแจ้งเตือนผู้ป่วยอัตโนมัติ และเพิ่มคำแนะนำการเตรียมตัวประจำคลินิก</p></div>
      <button onClick={async () => { setMessage(''); try { const r = await api('clinics/sync', 'POST', {}) as { count: number }; setMessage(`อ่านรายชื่อคลินิกจาก HOSxP แล้ว ${r.count} คลินิก`); reload(); } catch (e) { setMessage(e instanceof Error ? e.message : 'อ่าน HOSxP ไม่ได้'); } }}>อ่านรายชื่อคลินิกจาก HOSxP</button></div>
    <div className="notice"><strong>เปิดคลินิกแล้วจะเกิดอะไร</strong><span>เปิดแล้ว ผู้ป่วยของคลินิกนั้นจะได้รับข้อความเมื่อมีการลงนัดใหม่ เลื่อนนัด หรือยกเลิกนัดหลังจากนี้ และเมื่อใกล้ถึงวันนัด ระบบไม่ย้อนส่งนัดที่ลงไว้ก่อนเปิด (ยกเว้นข้อความเตือนก่อนวันนัด) ถ้าปิดคลินิก ข้อความที่ยังรอส่งจะถูกยกเลิก</span></div>
    {message && <p role="status" className="helper">{message}</p>}
    {error && <div role="alert" className="error">{error}</div>}
    {editing && <FormPanel title={`คำแนะนำประจำคลินิก · ${editing.name}`} onClose={() => setEditing(undefined)} onSubmit={async f => {
      await api(`clinics/${encodeURIComponent(editing.code)}`, 'PATCH', { enabled: !!editing.enabled, note: s(f.get('note')), version: editing.version }); reload(); }}>
      <label className="span-all">คำแนะนำการเตรียมตัว (บรรทัดละ 1 ข้อ แสดงในข้อความแจ้งเตือนทุกนัดของคลินิกนี้)
        <textarea name="note" rows={5} maxLength={1000} defaultValue={editing.note} placeholder={'เช่น\nงดน้ำงดอาหารหลังเที่ยงคืน\nนำผลตรวจเดิมมาด้วย'}/></label>
      <p className="helper span-all">ถ้าเจ้าหน้าที่ติ๊กคำแนะนำไว้ในนัดของ HOSxP ข้อความจะแสดงทั้งสองส่วน</p>
    </FormPanel>}
    <div className="surface" aria-busy={busy}><Table headers={['คลินิก', 'นัดล่วงหน้า', 'คำแนะนำประจำคลินิก', 'แจ้งเตือนอัตโนมัติ']} empty={!data?.length}>
      {data?.map(c => <tr key={c.code}>
        <td><strong>{c.name}</strong><small>รหัส {c.code}{!c.in_source && c.code !== '-' ? ' · ไม่พบในตาราง clinic ของ HOSxP แล้ว' : ''}</small></td>
        <td>{n(c.upcoming).toLocaleString()}</td>
        <td>{c.note ? <span className="clinic-note">{c.note}</span> : <span className="muted">—</span>} <button className="link-button" onClick={() => setEditing(c)}>แก้ไข</button></td>
        <td><button type="button" role="switch" aria-checked={!!c.enabled} aria-label={`แจ้งเตือนคลินิก ${c.name}`} className={`switch ${c.enabled ? 'on' : ''}`} disabled={busyCode === c.code} onClick={() => toggle(c)}><span/></button> {c.enabled ? 'เปิด' : 'ปิด'}</td>
      </tr>)}
    </Table></div>
  </>;
}
