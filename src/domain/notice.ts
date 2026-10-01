// Appointment notice sent to the patient's LINE หมอพร้อม. Plain text, HTML and a Flex card come from one Notice.
export type NoticeKind = 'NEW' | 'CHANGED' | 'REMINDER' | 'MANUAL' | 'CANCELLED';
export type Notice = { kind: NoticeKind; name: string; date: string; time: string | null; clinic: string; location: string; daysBefore?: number;
  /** LAB items from HOSxP (ticked note2 + LAB order form) */ tests?: string[];
  /** Preparation instructions ticked in HOSxP (note1 / perform_text) */ preparation?: string[];
  /** The clinic's own standing advice, set by admin in the web */ clinicNote?: string;
  /** Hospital phone or contact point for rescheduling */ contact?: string };

export const HOSPITAL_NAME = 'โรงพยาบาลพลับพลาชัย';
const TITLES: Record<NoticeKind, string> = {
  NEW: 'แจ้งวันนัดหมาย',
  MANUAL: 'แจ้งวันนัดหมาย',
  CHANGED: 'แจ้งเปลี่ยนแปลงวันนัด',
  REMINDER: 'แจ้งเตือนก่อนถึงวันนัด',
  CANCELLED: 'แจ้งยกเลิกวันนัด',
};
export const noticeTitle = (n: Notice) => TITLES[n.kind];
export function thaiLongDate(day: string) {
  return new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' })
    .format(new Date(`${day}T00:00:00+07:00`));
}
export function noticeLead(n: Notice) {
  if (n.kind === 'CANCELLED') return 'นัดหมายของท่านต่อไปนี้ได้ถูกยกเลิกแล้ว';
  if (n.kind === 'REMINDER') return n.daysBefore === 0 ? 'วันนี้เป็นวันนัดของท่าน' : n.daysBefore === 1 ? 'พรุ่งนี้เป็นวันนัดของท่าน' : `อีก ${n.daysBefore ?? 1} วันจะถึงวันนัดของท่าน`;
  if (n.kind === 'CHANGED') return 'นัดหมายของท่านมีการเปลี่ยนแปลง รายละเอียดใหม่ดังนี้';
  return 'ท่านมีนัดหมายกับโรงพยาบาล รายละเอียดดังนี้';
}
export function noticeRows(n: Notice): [string, string, string][] {
  return [
    ['📅', 'วันที่', thaiLongDate(n.date)],
    ['⏰', 'เวลา', n.time ? `${n.time.slice(0, 5)} น.` : 'โปรดติดต่อเจ้าหน้าที่เพื่อยืนยันเวลา'],
    ['🩺', 'คลินิก', n.clinic || '-'],
    // Plain Thai categories only; the item codes stay in HOSxP.
    ...(n.tests?.length && n.kind !== 'CANCELLED' ? [['🧪', 'การตรวจ', labGroups(n.tests).map(g => `• ${g}`).join('\n')] as [string, string, string]] : []),
    ['📍', 'ติดต่อที่', n.location || HOSPITAL_NAME],
  ];
}
export const NOTICE_PREPARE = ['บัตรประจำตัวประชาชน', 'บัตรนัด หรือสมุดประจำตัวผู้ป่วย (ถ้ามี)', 'ยาที่รับประทานอยู่ (ถ้ามี)'];

const URINE = /urine|\bUA\b|U\/A|ปัสสาวะ|microalbumin|UACR/i;
const EKG = /\bEKG\b|\bECG\b|คลื่นไฟฟ้าหัวใจ/i;
const SPUTUM = /sputum|\bAFB\b|เสมหะ/i;
const OTHER_ITEM = /^อื่น/;
const XRAY = /x-?ray|\bCXR\b|chest film|เอกซเรย์|เอ็กซเรย์|ภาพรังสี/i;
const STOOL = /stool|อุจจาระ|occult|FOBT|FIT\b/i;
const FASTING = /FBS|FPG|glucose|น้ำตาล|chol|triglyceride|\bTG\b|HDL|LDL|lipid|ไขมัน/i;
export function labGroups(tests: string[] = []) {
  const groups: string[] = [];
  const other = [STOOL, EKG, SPUTUM, XRAY, OTHER_ITEM];
  if (tests.some(t => !URINE.test(t) && !other.some(re => re.test(t)))) groups.push('การตรวจเลือด');
  if (tests.some(t => URINE.test(t))) groups.push('การตรวจปัสสาวะ');
  if (tests.some(t => other.some(re => re.test(t)))) groups.push('การตรวจอื่นๆ');
  return groups;
}
export const clinicNoteLines = (note?: string) => (note ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
export function noticePreparation(n: Notice) {
  // HOSxP instructions for this appointment first, then the clinic's standing advice.
  // Generic LAB advice is only a fallback when neither says anything.
  const own = [...(n.preparation ?? []), ...clinicNoteLines(n.clinicNote)];
  if (own.length) return [...new Set(own)];
  const tests = n.tests ?? [], steps: string[] = [];
  if (tests.some(t => FASTING.test(t))) steps.push('งดอาหารและเครื่องดื่มทุกชนิด ยกเว้นน้ำเปล่า อย่างน้อย 8 ชั่วโมงก่อนการเจาะเลือด');
  if (tests.some(t => URINE.test(t))) steps.push('เก็บตัวอย่างปัสสาวะช่วงกลางของการถ่ายปัสสาวะ ตามคำแนะนำของเจ้าหน้าที่ห้องปฏิบัติการ');
  if (tests.some(t => SPUTUM.test(t))) steps.push('เก็บเสมหะในช่วงเช้าหลังตื่นนอน โดยบ้วนปากด้วยน้ำเปล่าก่อน ตามคำแนะนำของเจ้าหน้าที่');
  if (tests.some(t => STOOL.test(t))) steps.push('รับภาชนะเก็บตัวอย่างอุจจาระและคำแนะนำจากเจ้าหน้าที่ห้องปฏิบัติการ');
  return steps;
}
const contactLine = (n: Notice) => n.contact ? `โปรดติดต่อ ${n.contact}` : 'โปรดติดต่อโรงพยาบาล';
export const noticeFooter = (n: Notice) => n.kind === 'CANCELLED'
  ? ['ไม่ต้องมารับบริการตามวันและเวลาดังกล่าว', `หากต้องการนัดใหม่ หรือไม่ได้ขอยกเลิก ${contactLine(n)}`]
  : ['กรุณามาถึงก่อนเวลานัด 15 นาที', `หากไม่สะดวกหรือต้องการเลื่อนนัด ${contactLine(n)}`];
// A cancelled appointment needs nothing brought or prepared.
export const showsPreparation = (n: Notice) => n.kind !== 'CANCELLED';

function prepareLines(n: Notice) {
  if (!showsPreparation(n)) return [];
  const steps = noticePreparation(n);
  return [`🪪 สิ่งที่ต้องนำมา : ${NOTICE_PREPARE.join(', ')}`, ...(steps.length ? ['📝 การเตรียมตัว', ...steps.map(s => `   - ${s}`)] : [])];
}
const kindIcon = (n: Notice) => n.kind === 'REMINDER' ? '🔔' : n.kind === 'CHANGED' ? '🔄' : n.kind === 'CANCELLED' ? '❌' : '📋';
export function noticeText(n: Notice) {
  return [
    `🏥 ${HOSPITAL_NAME}`,
    `━━━━━━━━━━━━━━`,
    `${kindIcon(n)} ${noticeTitle(n)}`,
    '',
    `เรียน คุณ${n.name}`,
    noticeLead(n),
    '',
    ...noticeRows(n).map(([icon, label, value]) => `${icon} ${label} : ${value}`),
    '',
    ...prepareLines(n),
    '',
    ...noticeFooter(n).map(line => `• ${line}`),
  ].join('\n');
}

// What the provider sends. The MOPH Template card already shows the hospital logo (from CMS),
// the recipient name and the send time, so the card text skips those.
export type OutboundMessage = { name: string; title: string; text: string; html: string; notice?: Notice };
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function noticeCardText(n: Notice) {
  return [noticeLead(n), '', ...noticeRows(n).map(([icon, label, value]) => `${icon} ${label} : ${value}`), '', ...prepareLines(n), '', ...noticeFooter(n)].join('\n');
}
export function noticeHtml(n: Notice) {
  const steps = noticePreparation(n);
  return `<div><strong>${escapeHtml(noticeTitle(n))}</strong><br/>${escapeHtml(noticeLead(n))}<br/>`
    + noticeRows(n).map(([, label, value]) => `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}`).join('<br/>')
    + (showsPreparation(n) ? `<br/><br/><strong>สิ่งที่ต้องนำมา:</strong> ${escapeHtml(NOTICE_PREPARE.join(', '))}` : '')
    + (showsPreparation(n) && steps.length ? `<br/><strong>การเตรียมตัว:</strong><br/>${steps.map(s => '- ' + escapeHtml(s)).join('<br/>')}` : '')
    + `<br/><br/>${noticeFooter(n).map(escapeHtml).join('<br/>')}</div>`;
}
export function noticeMessage(n: Notice): OutboundMessage {
  return { name: n.name, title: noticeTitle(n), text: noticeCardText(n), html: noticeHtml(n), notice: n };
}
export function plainMessage(text: string, title = 'แจ้งเตือนนัดหมาย', name = ''): OutboundMessage {
  return { name, title, text, html: `<div>${escapeHtml(text).replace(/\n/g, '<br/>')}</div>` };
}
export const TEST_NOTIFICATION_TEXT = `ทดสอบระบบแจ้งเตือนนัดหมาย ${HOSPITAL_NAME}\nหากท่านได้รับข้อความนี้ แสดงว่าระบบส่งข้อความผ่านหมอพร้อมได้ตามปกติ ไม่ต้องดำเนินการใดๆ`;

export const NOTICE_COLORS: Record<NoticeKind, string> = { NEW: '#0D5B44', MANUAL: '#0D5B44', REMINDER: '#B45309', CHANGED: '#1D4ED8', CANCELLED: '#B91C1C' };
// Header with the hospital photo: the photo sets the height (2:1), a gradient box fades from the notice
// colour on the left (under the logo and title) to clear on the right, and the content sits on top.
// Flex boxes cannot take a background image, so the layers are stacked with absolute positioning.
const FILL = { position: 'absolute', offsetTop: '0px', offsetBottom: '0px', offsetStart: '0px', offsetEnd: '0px' };
function photoHeader(color: string, photoUrl: string, contents: object[]) {
  return { type: 'box', layout: 'vertical', paddingAll: '0px', contents: [
    { type: 'image', url: photoUrl, size: 'full', aspectMode: 'cover', aspectRatio: '2:1' },
    { type: 'box', layout: 'vertical', ...FILL, contents: [],
      background: { type: 'linearGradient', angle: '90deg', startColor: color, centerColor: `${color}CC`, centerPosition: '50%', endColor: `${color}00` } },
    { type: 'box', layout: 'horizontal', spacing: 'lg', paddingAll: '18px', alignItems: 'center', ...FILL, contents }] };
}
// Our own LINE Flex bubble (LINE Developers Flex Message spec). logoUrl must be public HTTPS.
export function noticeFlex(n: Notice, logoUrl?: string, photoUrl?: string) {
  const color = NOTICE_COLORS[n.kind], steps = noticePreparation(n);
  const row = ([icon, label, value]: [string, string, string]) => ({ type: 'box', layout: 'horizontal', spacing: 'md', contents: [
    { type: 'text', text: `${icon} ${label}`, size: 'sm', color: '#6B7280', flex: 3, wrap: true },
    { type: 'text', text: value, size: 'sm', color: '#111827', weight: 'bold', wrap: true, flex: 6 }] });
  const headerContents = [
        ...(logoUrl ? [{ type: 'box', layout: 'vertical', width: '52px', height: '52px', cornerRadius: '26px', backgroundColor: '#FFFFFF', paddingAll: '4px', flex: 0,
          contents: [{ type: 'image', url: logoUrl, size: 'full', aspectMode: 'fit', aspectRatio: '1:1' }] }] : []),
        // Over the photo the title keeps to the solid part of the fade, so white text stays readable.
        { type: 'box', layout: 'vertical', justifyContent: 'center', ...(photoUrl ? { maxWidth: '58%' } : {}), contents: [
          { type: 'text', text: HOSPITAL_NAME, color: '#FFFFFFCC', size: 'xs' },
          { type: 'text', text: noticeTitle(n), color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true }] }];
  return {
    type: 'flex', altText: `${noticeTitle(n)} · ${thaiLongDate(n.date)}`,
    contents: { type: 'bubble', size: 'mega',
      header: photoUrl ? photoHeader(color, photoUrl, headerContents) : { type: 'box', layout: 'horizontal', spacing: 'lg', backgroundColor: color, paddingAll: '18px', contents: headerContents },
      body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '18px', contents: [
        { type: 'box', layout: 'vertical', backgroundColor: '#EEF4F1', cornerRadius: '10px', paddingAll: '12px', contents: [
          { type: 'text', text: `คุณ${n.name}`, weight: 'bold', size: 'md', align: 'center', wrap: true, color: '#0F3D2E' }] },
        { type: 'text', text: noticeLead(n), size: 'sm', color: '#374151', wrap: true },
        { type: 'separator', margin: 'md' },
        { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md', contents: noticeRows(n).map(row) },
        ...(!showsPreparation(n) ? [] : [{ type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#FFF7E6', cornerRadius: '10px', paddingAll: '12px', spacing: 'xs', contents: [
          { type: 'text', text: '🪪 สิ่งที่ต้องนำมา', weight: 'bold', size: 'sm', color: '#92400E' },
          ...NOTICE_PREPARE.map(item => ({ type: 'text', text: `• ${item}`, size: 'sm', color: '#78350F', wrap: true })),
          ...(steps.length ? [{ type: 'text', text: '📝 การเตรียมตัว', weight: 'bold', size: 'sm', color: '#92400E', margin: 'md' },
            ...steps.map(item => ({ type: 'text', text: `• ${item}`, size: 'sm', color: '#78350F', wrap: true }))] : [])] }])] },
      footer: { type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '14px', backgroundColor: '#F7F9F8', contents:
        noticeFooter(n).map(text => ({ type: 'text', text: `• ${text}`, size: 'xs', color: '#6B7280', wrap: true })) },
    },
  };
}
