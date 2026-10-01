import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inSendWindow, nextSendTime } from '../src/domain/send-window';
import { noticeText, noticeMessage, noticePreparation, noticeFlex, type Notice } from '../src/domain/notice';
import { validCid } from '../src/domain/validation';
import { mophRequest, classifyResponse } from '../src/providers/moph-alert';

const window = { start: '07:00', end: '20:00' };
const at = (bangkok: string) => new Date(`${bangkok}+07:00`);

test('send window: inside sends now, night waits for the next opening (Bangkok time, stored UTC)', () => {
  assert.equal(inSendWindow(window, at('2026-10-01T07:00:00')), true);
  assert.equal(inSendWindow(window, at('2026-10-01T19:59:00')), true);
  assert.equal(inSendWindow(window, at('2026-10-01T20:00:00')), false);
  assert.equal(nextSendTime(window, at('2026-10-01T12:00:00')), null);
  // 22:30 on the 1st -> 07:00 on the 2nd Bangkok = 00:00 UTC on the 2nd.
  assert.equal(nextSendTime(window, at('2026-10-01T22:30:00')), '2026-10-02 00:00:00.000');
  // 05:00 on the 2nd -> 07:00 the same day.
  assert.equal(nextSendTime(window, at('2026-10-02T05:00:00')), '2026-10-02 00:00:00.000');
});

const base: Notice = { kind: 'NEW', name: 'สมชาย ใจดี', date: '2026-10-15', time: '09:30:00', clinic: 'คลินิกเบาหวาน', location: 'OPD ชั้น 1' };
test('patient notice shows clinic, time, what to bring and how to reschedule', () => {
  const text = noticeText({ ...base, contact: 'ห้องบัตร โทร 044-000000' });
  assert.match(text, /แจ้งวันนัดหมาย/);
  assert.match(text, /เรียน คุณสมชาย ใจดี/);
  assert.match(text, /คลินิก : คลินิกเบาหวาน/);
  assert.match(text, /09:30 น\./);
  assert.match(text, /บัตรประจำตัวประชาชน/);
  assert.match(text, /โปรดติดต่อ ห้องบัตร โทร 044-000000/);
  assert.match(noticeText({ ...base, time: null }), /โปรดติดต่อเจ้าหน้าที่เพื่อยืนยันเวลา/);
});
test('notice kinds: reminder lead, changed title, cancellation has no preparation', () => {
  assert.match(noticeText({ ...base, kind: 'REMINDER', daysBefore: 1 }), /พรุ่งนี้เป็นวันนัดของท่าน/);
  assert.match(noticeText({ ...base, kind: 'REMINDER', daysBefore: 0 }), /วันนี้เป็นวันนัดของท่าน/);
  assert.match(noticeText({ ...base, kind: 'CHANGED' }), /แจ้งเปลี่ยนแปลงวันนัด/);
  const cancelled = noticeText({ ...base, kind: 'CANCELLED', tests: ['FBS'] });
  assert.match(cancelled, /ถูกยกเลิกแล้ว/);
  assert.doesNotMatch(cancelled, /สิ่งที่ต้องนำมา|การตรวจ :/);
});
test('preparation: HOSxP lines then the clinic note; generic LAB advice only as a fallback', () => {
  assert.deepEqual(noticePreparation({ ...base, preparation: ['งดน้ำงดอาหาร'], clinicNote: 'นำยาเดิมมาด้วย\n\nงดน้ำงดอาหาร' }), ['งดน้ำงดอาหาร', 'นำยาเดิมมาด้วย']);
  assert.match(noticePreparation({ ...base, tests: ['FBS'] })[0], /งดอาหาร/);
  assert.deepEqual(noticePreparation({ ...base, tests: ['FBS'], clinicNote: 'มาก่อน 8 โมง' }), ['มาก่อน 8 โมง']);
});
test('outbound: HTML is escaped and the flex card carries the title', () => {
  const m = noticeMessage({ ...base, clinic: '<b>X</b>' });
  assert.match(m.html, /&lt;b&gt;X&lt;\/b&gt;/);
  assert.equal((noticeFlex(base) as { altText: string }).altText.startsWith('แจ้งวันนัดหมาย'), true);
  const req = mophRequest('1101700203450', m, 'template');
  assert.equal((req.body as { name: string }).name, 'สมชาย ใจดี');
});
test('CID checksum and MOPH response classification', () => {
  assert.equal(validCid('1101700203450'), true);
  assert.equal(validCid('1101700203451'), false);
  assert.equal(validCid(''), false);
  assert.equal(classifyResponse(200, { message_code: '200' }).outcome, 'ACCEPTED');
  assert.equal(classifyResponse(500, {}).outcome, 'UNKNOWN');
  assert.equal(classifyResponse(200, { message_code: '401', message: 'no cid' }).outcome, 'REJECTED');
});

test('flex card: photo header fading into the notice colour, date box first, plain header without a photo', async () => {
  const n: Notice = { kind: 'NEW', name: 'ทดสอบ', date: '2027-01-29', time: '09:00:00', clinic: 'ทันตกรรม', location: 'ห้องบัตร' };
  const card = noticeFlex(n, 'https://example.test/hospital-logo.png', 'https://example.test/hospital-header.jpg') as { contents: { header: { contents: Record<string, unknown>[] }; body: { contents: Record<string, unknown>[] } } };
  const [photo, fade, content] = card.contents.header.contents;
  assert.deepEqual([photo.type, photo.url, photo.aspectMode, photo.aspectRatio], ['image', 'https://example.test/hospital-header.jpg', 'cover', '20:13']);
  assert.deepEqual(fade.background, { type: 'linearGradient', angle: '0deg', startColor: '#0D5B44', centerColor: '#0D5B44CC', centerPosition: '45%', endColor: '#0D5B4400' });
  for (const layer of [fade, content]) assert.equal(layer.position, 'absolute');
  assert.ok(JSON.stringify(content).includes('hospital-logo.png'));
  const body = JSON.stringify(card.contents.body);
  for (const part of ['เรียน คุณทดสอบ', '"text":"29"', 'ม.ค. 70', 'วันศุกร์ที่ 29 มกราคม 2570', '09:00 น.', 'ห้องบัตร', 'สิ่งที่ต้องนำมา']) assert.ok(body.includes(part), part);
  const red = noticeFlex({ ...n, kind: 'CANCELLED' }, undefined, 'https://example.test/hospital-header.jpg') as typeof card;
  assert.equal((red.contents.header.contents[1].background as { startColor: string }).startColor, '#B91C1C');
  assert.ok(JSON.stringify(red.contents.body).includes('line-through'), 'cancelled date and time are struck through');
  assert.ok(!JSON.stringify(red.contents.body).includes('สิ่งที่ต้องนำมา'));
  assert.ok(JSON.stringify(noticeFlex({ ...n, time: null })).includes('โปรดติดต่อเจ้าหน้าที่เพื่อยืนยันเวลา'));
  const plain = JSON.stringify(noticeFlex(n, 'https://example.test/hospital-logo.png'));
  assert.ok(!plain.includes('hospital-header.jpg') && !plain.includes('linearGradient'), 'no photo URL: plain colour header');
  const { publicHeaderUrl } = await import('../src/providers/moph-alert');
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { APP_ORIGIN: 'https://hc.example.test/', PUBLIC_LOGO_URL: '', PUBLIC_HEADER_URL: '' });
    assert.equal(publicHeaderUrl(), 'https://hc.example.test/hospital-header.jpg');
    Object.assign(process.env, { APP_ORIGIN: 'http://192.168.1.5:5600' });
    assert.equal(publicHeaderUrl(), undefined, 'LINE cannot load a LAN or http address');
  } finally { process.env = saved; }
});
