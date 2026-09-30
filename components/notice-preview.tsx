'use client';
import { useState } from 'react';
import { HOSPITAL_NAME, noticeFooter, showsPreparation, NOTICE_PREPARE, noticePreparation, noticeLead, noticeRows, noticeTitle, type Notice, type NoticeKind } from '@/src/domain/notice';

const SAMPLE: Omit<Notice, 'kind'> = { name: 'ตัวอย่าง ผู้ป่วย', date: '2027-01-29', time: '08:30:00', clinic: 'คลินิกเบาหวาน', location: 'ตึกผู้ป่วยนอก ชั้น 1', daysBefore: 1,
  tests: ['FBS', 'HbA1c', 'Creatinine'], clinicNote: 'นำยาเบาหวานที่รับประทานอยู่มาด้วย' };
const KINDS: [NoticeKind, string][] = [['NEW', 'ลงนัดใหม่'], ['REMINDER', 'ก่อนวันนัด 1 วัน'], ['CHANGED', 'เลื่อนนัด'], ['MANUAL', 'กดส่งเอง'], ['CANCELLED', 'ยกเลิกนัด']];

// Same layout as noticeFlex(): header with hospital logo, name box, details, notes.
export function NoticeCard({ notice }: { notice: Notice }) {
  const steps = noticePreparation(notice);
  return <div className={`notice-card kind-${notice.kind.toLowerCase()}`}>
    <div className="notice-card-head"><span className="notice-card-logo"><img src="/hospital-logo.png" alt="" width={44} height={44}/* eslint-disable-line @next/next/no-img-element *//></span>
      <div><small>{HOSPITAL_NAME}</small><strong>{noticeTitle(notice)}</strong></div></div>
    <div className="notice-card-body">
      <div className="notice-card-name">คุณ{notice.name}</div>
      <p className="notice-card-lead">{noticeLead(notice)}</p>
      <dl>{noticeRows(notice).map(([icon, label, value]) => <div key={label}><dt>{icon} {label}</dt><dd>{value}</dd></div>)}</dl>
      {showsPreparation(notice) && <div className="notice-card-prepare"><strong>🪪 สิ่งที่ต้องนำมา</strong><ul>{NOTICE_PREPARE.map(item => <li key={item}>{item}</li>)}</ul>
        {steps.length > 0 && <><strong>📝 การเตรียมตัว</strong><ul>{steps.map(item => <li key={item}>{item}</li>)}</ul></>}</div>}
    </div>
    <ul className="notice-card-foot">{noticeFooter(notice).map(line => <li key={line}>{line}</li>)}</ul>
  </div>;
}

export function NoticePreview() {
  const [kind, setKind] = useState<NoticeKind>('NEW');
  return <section className="surface padded" aria-label="ตัวอย่างข้อความแจ้งเตือน"><div className="section-head"><div>
    <h3>ตัวอย่างข้อความที่ผู้ป่วยได้รับใน LINE หมอพร้อม</h3>
    <p className="helper">การ์ด LINE Flex ส่งผ่าน MOPH Alert · ถ้า MOPH ไม่รับการ์ดนี้ ระบบจะส่งเป็นการ์ดมาตรฐานของ MOPH แทน</p></div></div>
    <div className="subnav">{KINDS.map(([k, label]) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>)}</div>
    <div className="notice-preview"><NoticeCard notice={{ ...SAMPLE, kind }}/>
      <div className="notice-when"><h4>ส่งเมื่อไหร่</h4><ul>
        <li><strong>ลงนัดใหม่ / เลื่อนนัด</strong> เมื่อ worker พบนัดใหม่ หรือวัน เวลา คลินิก จุดติดต่อเปลี่ยนใน HOSxP</li>
        <li><strong>ก่อนวันนัด</strong> ตามรอบที่ตั้ง เริ่มส่งตามเวลาที่กำหนด (ค่าเริ่มต้น 08:00 น.)</li>
        <li><strong>ยกเลิกนัด</strong> เมื่อนัดที่ยังไม่ถึงวันถูกลบหรือเปลี่ยนเป็นสถานะยกเลิกใน HOSxP</li>
        <li><strong>กดส่งเอง</strong> ปุ่ม “ส่งแจ้งเตือน” ในเมนูนัดหมายจาก HOSxP ส่งทันที</li>
        <li>ส่งเฉพาะคลินิกที่เปิดไว้ ไม่ส่งตอนกลางคืน และไม่ส่งให้ผู้ป่วยที่ของดรับข้อความ</li>
      </ul></div></div>
  </section>;
}
