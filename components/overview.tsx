'use client';
import { Table, STATUS_NAMES, n, s, useLoad, type Api } from './ui';

type Data = { today: number; tomorrow: number; upcoming: number; clinicsEnabled: number; clinicsTotal: number;
  last24h: { status: string; n: number }[]; sync: { initialized: number; last_success_at: string | null; last_error: string | null; last_error_at: string | null; last_count: number | null } };
export function Overview({ api, go }: { api: Api; go: (tab: string) => void }) {
  const { data, error, busy, reload } = useLoad<Data>(api, 'overview');
  if (error) return <div role="alert" className="error">{error} <button onClick={reload}>ลองอีกครั้ง</button></div>;
  if (!data) return <div className="loading" role="status">กำลังโหลดข้อมูล…</div>;
  const sync = data.sync;
  return <div aria-busy={busy}>
    <div className="section-head"><div><h2>ภาพรวม</h2><p className="muted">นัดที่ยังไม่ถึงเวลาในช่วงที่ระบบติดตาม และผลแจ้งเตือน 24 ชั่วโมงล่าสุด</p></div><button onClick={reload}>โหลดใหม่</button></div>
    <div className="metrics">
      <div><span>นัดวันนี้</span><strong>{data.today.toLocaleString()}<small>นัด</small></strong><p>ยังไม่ถึงเวลานัด</p></div>
      <div><span>นัดพรุ่งนี้</span><strong>{data.tomorrow.toLocaleString()}<small>นัด</small></strong><p>ทุกคลินิก</p></div>
      <div><span>นัดล่วงหน้าทั้งหมด</span><strong>{data.upcoming.toLocaleString()}<small>นัด</small></strong><p>ในช่วงที่ติดตาม</p></div>
      <div><span>คลินิกที่เปิดแจ้งเตือน</span><strong>{data.clinicsEnabled}<small>/ {data.clinicsTotal}</small></strong><p><button className="link-button" onClick={() => go('clinics')}>ตั้งค่าคลินิก</button></p></div>
    </div>
    {!data.clinicsEnabled && <div className="notice"><strong>ยังไม่ได้เปิดคลินิกใดเลย</strong><span>ระบบจะไม่ส่งข้อความอัตโนมัติจนกว่าจะเปิดคลินิกในเมนู “คลินิก” และเปิดการแจ้งเตือนในเมนู “แจ้งเตือน”</span></div>}
    <p className="helper">อ่าน HOSxP: {sync?.initialized ? 'เริ่มติดตามนัดแล้ว' : 'รอ worker อ่านข้อมูลตั้งต้น (รอบแรกบันทึกเป็นฐาน ไม่ส่งข้อความ)'} · สำเร็จล่าสุด (UTC): {s(sync?.last_success_at) || '—'} · อ่านได้ {n(sync?.last_count).toLocaleString()} นัด
      {sync?.last_error && <><br/><span className="error-text">ผิดพลาดล่าสุด {s(sync.last_error_at)} UTC: {sync.last_error}</span></>}</p>
    <div className="surface"><Table headers={['สถานะแจ้งเตือน 24 ชั่วโมงล่าสุด', 'จำนวน']} empty={!data.last24h.length}>
      {data.last24h.map(r => <tr key={r.status}><td><span className="badge">{STATUS_NAMES[r.status] ?? r.status}</span></td><td>{n(r.n).toLocaleString()}</td></tr>)}
    </Table></div>
  </div>;
}
