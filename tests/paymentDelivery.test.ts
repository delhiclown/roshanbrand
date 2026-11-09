import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSubmittedOrderUpdate,
  deliverOnce,
  getUtrReviewStatus,
  getTrackComplaintStatus,
  isTrackComplaintStatus,
  isOrderExpired,
  matchesSmsPayment,
  parseCreditedSms,
  rejectOrderAndReleaseStock,
  releaseStock,
  reserveStock,
  smsWebhookStatus,
  submitUtr,
  shouldExpirePaymentOrder,
  type DeliveryState,
} from '../src/paymentDelivery.ts';
import { getTrackOrderMessage } from '../src/constants.ts';

interface TestDraft {
  orderId: string;
  expiresAt: number;
}

interface TestOrder {
  orderId: string;
  utr: string;
  status: string;
}

function createFlow() {
  const drafts: TestDraft[] = [];
  const orders: TestOrder[] = [];
  const vault: { poolType: string; isAssigned: boolean; reservedOrderId?: string }[] = [
    { poolType: 'permanent', isAssigned: false },
    { poolType: 'permanent', isAssigned: false },
    { poolType: 'permanent', isAssigned: false },
  ];

  const openQr = (orderId: string, expiresAt: number) => {
    drafts.push({ orderId, expiresAt });
  };
  const closeQr = (orderId: string) => {
    const index = drafts.findIndex((draft) => draft.orderId === orderId);
    if (index >= 0) drafts.splice(index, 1);
  };
  const submit = (orderId: string, utr: string) => {
    const draftIndex = drafts.findIndex((draft) => draft.orderId === orderId);
    if (draftIndex < 0 || !/^\d{12}$/.test(utr)) return false;
    const status: DeliveryState = { delivered: false, status: 'draft' };
    if (!submitUtr(status) || !reserveStock(vault, 'permanent', orderId, 1)) return false;
    drafts.splice(draftIndex, 1);
    orders.push({ orderId, utr, status: status.status });
    return true;
  };

  return { drafts, orders, vault, openQr, closeQr, submit };
}

test('Opening the QR and going back creates no submitted order or stock reservation', () => {
  const flow = createFlow();
  flow.openQr('draft-1', Date.now() + 15 * 60_000);
  flow.closeQr('draft-1');

  assert.equal(flow.orders.length, 0);
  assert.equal(flow.vault.filter((item) => item.reservedOrderId).length, 0);
});

test('Submitting a valid UTR creates the order and reserves the required stock', () => {
  const flow = createFlow();
  flow.openQr('draft-2', Date.now() + 15 * 60_000);

  assert.equal(flow.submit('draft-2', '123456789012'), true);
  assert.deepEqual(flow.orders, [
    { orderId: 'draft-2', utr: '123456789012', status: 'utr_submitted' },
  ]);
  assert.equal(flow.vault.filter((item) => item.reservedOrderId === 'draft-2').length, 1);
  assert.equal(flow.submit('draft-2', ''), false);
});

test('A rejected UTR order can accept a corrected retry', () => {
  const state: DeliveryState = { delivered: false, status: 'rejected' };

  assert.equal(submitUtr(state), true);
  assert.equal(state.status, 'utr_submitted');

  const expiredDraft: DeliveryState = { delivered: false, status: 'expired' };
  assert.equal(submitUtr(expiredDraft), true);
  assert.equal(expiredDraft.status, 'utr_submitted');
});

test('UTR submission records server time without shortening the payment grace deadline', async () => {
  const submittedAt = new Date('2026-10-27T12:00:00.000Z');
  const saved = { submittedAt: null as unknown };
  const mockPostgres = {
    async query(text: string, values: readonly unknown[]) {
      assert.match(text, /utr_submitted_at = \$3/);
      assert.match(text, /late_payment_pending_review/);
      assert.doesNotMatch(text, /expires_at = \$3/);
      const timestamp = values[2];
      if (!(timestamp instanceof Date)) {
        throw new TypeError('TIMESTAMPTZ value must be a JavaScript Date.');
      }
      saved.submittedAt = timestamp;
      return { rowCount: 1 };
    },
  };
  const update = createSubmittedOrderUpdate('order-ts', '123456789012', submittedAt);
  const result = await mockPostgres.query(update.text, update.values);

  assert.equal(result.rowCount, 1);
  assert.ok(saved.submittedAt instanceof Date);
  assert.equal(saved.submittedAt.toISOString(), submittedAt.toISOString());
});

test('UTRs submitted after the payment deadline go to manual late-payment review', () => {
  const expiresAt = new Date('2026-10-27T12:10:00.000Z');
  assert.equal(
    getUtrReviewStatus(expiresAt, new Date('2026-10-27T12:09:58.000Z')),
    'utr_submitted'
  );
  assert.equal(
    getUtrReviewStatus(expiresAt, new Date('2026-10-27T12:10:01.000Z')),
    'late_payment_pending_review'
  );
  assert.equal(
    getUtrReviewStatus(expiresAt, new Date('2026-10-27T12:15:00.000Z')),
    'late_payment_pending_review'
  );
  assert.equal(
    getUtrReviewStatus(expiresAt, new Date('2026-10-27T12:10:00.000Z')),
    'utr_submitted'
  );
});

test('A matching SMS delivers credentials only once', () => {
  assert.equal(
    matchesSmsPayment(
      { utr: '123456789012', amountPaise: 4900, createdAt: 100 },
      { utr: '123456789012', amountPaise: 4900, receivedAt: 101 }
    ),
    true
  );
  assert.equal(
    matchesSmsPayment(
      { utr: '123456789012', amountPaise: 4900, createdAt: 100 },
      { utr: '123456789012', amountPaise: 4901, receivedAt: 101 }
    ),
    false
  );
  const state: DeliveryState = { delivered: false, status: 'utr_submitted' };
  let credentialAssignments = 0;
  const deliver = () => {
    credentialAssignments += 1;
    return true;
  };

  assert.equal(deliverOnce(state, 'sms', deliver), 'delivered');
  assert.equal(deliverOnce(state, 'sms', deliver), 'already-delivered');
  assert.equal(credentialAssignments, 1);
  assert.deepEqual(state, { delivered: true, status: 'paid' });
});

test('SMS parsing accepts configured credit messages and skips debit and OTP messages', () => {
  const keywords = ['airtel', 'airpay'];
  assert.deepEqual(
    parseCreditedSms(
      'AIRTELBANK',
      'INR 49.00 credited. UTR 123456789012',
      keywords
    ),
    { ok: true, payment: { utr: '123456789012', amountPaise: 4900 } }
  );
  assert.deepEqual(
    parseCreditedSms(
      'AIRTELBANK',
      'INR 49.00 debited. UTR 123456789012',
      keywords
    ),
    { ok: false, reason: 'debit_message' }
  );
  assert.deepEqual(
    parseCreditedSms(
      'AIRTELBANK',
      'OTP 123456 sent for INR 49.00 received. UTR 123456789012',
      keywords
    ),
    { ok: false, reason: 'otp_message' }
  );
  assert.deepEqual(
    parseCreditedSms('OTHERBANK', 'INR 49 credited UTR 123456789012', keywords),
    { ok: false, reason: 'sender_not_allowed' }
  );
});

test('Missing or incorrect SMS webhook authorization maps to HTTP 401', () => {
  assert.equal(smsWebhookStatus(false), 401);
  assert.equal(smsWebhookStatus(true), 200);
});

test('Track complaints report the current payment state but never for delivered orders', () => {
  assert.equal(getTrackComplaintStatus(null), 'UTR not found');
  assert.equal(getTrackComplaintStatus('utr_submitted'), 'Waiting for SMS');
  assert.equal(getTrackComplaintStatus('paid_stock_pending'), 'Paid - Stock Pending');
  assert.equal(getTrackComplaintStatus('rejected'), 'Rejected');
  assert.equal(getTrackComplaintStatus('expired'), 'Order expired');
  assert.equal(getTrackComplaintStatus('paid'), null);
  assert.equal(getTrackComplaintStatus('utr_submitted', true), null);
  assert.equal(isTrackComplaintStatus('UTR not found'), true);
  assert.equal(isTrackComplaintStatus('Paid - Stock Pending'), true);
  assert.equal(isTrackComplaintStatus('Waiting for SMS'), true);
  assert.equal(isTrackComplaintStatus('Rejected'), false);
  assert.equal(isTrackComplaintStatus(null), false);
});

test('Track status messages use the customer-facing wording for each payment state', () => {
  assert.equal(
    getTrackOrderMessage('Paid - Stock Pending'),
    'Payment received. Your ID will be delivered as soon as stock is added. No need to check again and again.'
  );
  assert.equal(
    getTrackOrderMessage('UTR not found'),
    'We could not find this UTR yet. Please check the 12-digit number, or wait a few minutes and try again.'
  );
  assert.equal(
    getTrackOrderMessage('Waiting for SMS'),
    'We are waiting for your payment confirmation. Please wait a few minutes and check again.'
  );
  assert.equal(
    getTrackOrderMessage('Late Payment - Pending Review'),
    'Aapka payment verify ho raha hai. Agar paisa kat gaya hai to chinta na karein, order approve hote hi mil jayega.'
  );
  assert.equal(
    getTrackOrderMessage('Rejected'),
    'This payment could not be matched with an order. Please contact support.'
  );
});

test('An unmatched SMS can be matched and delivered when its UTR is submitted later', () => {
  const storedPayment = {
    utr: '123456789012',
    amountPaise: 4900,
    receivedAt: new Date('2026-10-27T12:01:00.000Z'),
  };
  const order = {
    utr: storedPayment.utr,
    amountPaise: storedPayment.amountPaise,
    createdAt: new Date('2026-10-27T12:00:00.000Z'),
  };
  const state: DeliveryState = { delivered: false, status: 'draft' };
  let credentialAssignments = 0;

  assert.equal(submitUtr(state), true);
  assert.equal(matchesSmsPayment(order, storedPayment), true);
  assert.equal(
    deliverOnce(state, 'sms', () => {
      credentialAssignments += 1;
      return true;
    }),
    'delivered'
  );
  assert.equal(credentialAssignments, 1);
});

test('Repeated SMS delivery attempts do not assign a second ID', () => {
  const state: DeliveryState = { delivered: false, status: 'utr_submitted' };
  let credentialAssignments = 0;
  const deliver = () => {
    credentialAssignments += 1;
    return true;
  };

  assert.equal(deliverOnce(state, 'sms', deliver), 'delivered');
  assert.equal(deliverOnce(state, 'sms', deliver), 'already-delivered');
  assert.equal(credentialAssignments, 1);
});

test('Rejecting an order immediately releases its reserved stock', () => {
  const vault: { poolType: string; isAssigned: boolean; reservedOrderId?: string }[] = [
    { poolType: 'permanent', isAssigned: false },
  ];
  assert.equal(reserveStock(vault, 'permanent', 'order-1', 1), true);
  assert.equal(vault.filter((item) => !item.isAssigned && !item.reservedOrderId).length, 0);

  const order = {
    status: 'pending_verification',
    paymentStatus: 'utr_submitted',
    adminNote: '',
    updatedAt: '',
  };
  assert.equal(rejectOrderAndReleaseStock(order, vault, 'order-1', '2026-10-27T12:00:00.000Z'), true);
  assert.equal(order.status, 'rejected');
  assert.equal(order.paymentStatus, 'rejected');
  assert.equal(vault.filter((item) => !item.isAssigned && !item.reservedOrderId).length, 1);
  assert.equal(
    rejectOrderAndReleaseStock(order, vault, 'order-1', '2026-10-27T12:01:00.000Z'),
    false
  );
});

test('Rejecting a waiting UTR order releases its reservation', () => {
  const vault: { poolType: string; isAssigned: boolean; reservedOrderId?: string }[] = [
    { poolType: 'permanent', isAssigned: false },
  ];
  assert.equal(reserveStock(vault, 'permanent', 'waiting-order', 1), true);
  const order = {
    status: 'utr_submitted',
    paymentStatus: 'utr_submitted',
    adminNote: '',
    updatedAt: '',
  };

  assert.equal(
    rejectOrderAndReleaseStock(order, vault, 'waiting-order', '2026-10-27T12:03:00.000Z'),
    true
  );
  assert.equal(order.status, 'rejected');
  assert.equal(order.paymentStatus, 'rejected');
  assert.equal(vault[0].reservedOrderId, undefined);
});

test('Draft cleanup expires only drafts past their 15-minute deadline', () => {
  const now = new Date('2026-10-27T12:15:00.000Z').getTime();
  const drafts = [
    { orderId: 'old', expiresAt: new Date(now - 1) },
    { orderId: 'current', expiresAt: new Date(now + 1) },
    { orderId: 'legacy-null', expiresAt: null },
  ];
  const remaining = drafts.filter((draft) => !isOrderExpired(draft.expiresAt, now));

  assert.deepEqual(remaining.map((draft) => draft.orderId), ['current']);
});

test('Payment UTR orders never expire automatically; only drafts expire after grace', () => {
  const now = new Date('2026-10-27T12:30:00.000Z');
  const graceExpiresAt = new Date('2026-10-27T12:15:00.000Z');
  assert.equal(shouldExpirePaymentOrder('draft', graceExpiresAt, now.getTime()), true);
  assert.equal(shouldExpirePaymentOrder('utr_submitted', graceExpiresAt, now.getTime()), false);
  assert.equal(
    shouldExpirePaymentOrder(
      'late_payment_pending_review',
      new Date('2026-10-27T12:29:00.000Z'),
      now.getTime()
    ),
    false
  );
});
