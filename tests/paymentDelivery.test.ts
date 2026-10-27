import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSubmittedOrderUpdate,
  deliverOnce,
  isOrderExpired,
  matchesSmsPayment,
  releaseStock,
  reserveStock,
  submitUtr,
  type DeliveryState,
} from '../src/paymentDelivery.ts';

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

test('UTR SQL update passes a Date for the TIMESTAMPTZ expires_at column', async () => {
  const submittedAt = new Date('2026-10-27T12:00:00.000Z');
  const saved = { expiresAt: null as unknown };
  const mockPostgres = {
    async query(text: string, values: readonly unknown[]) {
      assert.match(text, /expires_at = \$3/);
      const expiresAt = values[2];
      if (!(expiresAt instanceof Date)) {
        throw new TypeError('TIMESTAMPTZ value must be a JavaScript Date.');
      }
      saved.expiresAt = expiresAt;
      return { rowCount: 1 };
    },
  };
  const update = createSubmittedOrderUpdate('order-ts', '123456789012', submittedAt);
  const result = await mockPostgres.query(update.text, update.values);

  assert.equal(result.rowCount, 1);
  assert.ok(saved.expiresAt instanceof Date);
  assert.equal(saved.expiresAt.toISOString(), '2026-10-27T12:30:00.000Z');
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

test('Manual delivery followed by SMS does not assign a second ID', () => {
  const state: DeliveryState = { delivered: false, status: 'utr_submitted' };
  let credentialAssignments = 0;
  const deliver = () => {
    credentialAssignments += 1;
    return true;
  };

  assert.equal(deliverOnce(state, 'manual', deliver), 'delivered');
  assert.equal(deliverOnce(state, 'sms', deliver), 'already-delivered');
  assert.equal(credentialAssignments, 1);
});

test('Rejecting an order immediately releases its reserved stock', () => {
  const vault: { poolType: string; isAssigned: boolean; reservedOrderId?: string }[] = [
    { poolType: 'permanent', isAssigned: false },
  ];
  assert.equal(reserveStock(vault, 'permanent', 'order-1', 1), true);
  assert.equal(vault.filter((item) => !item.isAssigned && !item.reservedOrderId).length, 0);

  assert.equal(releaseStock(vault, 'order-1'), 1);
  assert.equal(vault.filter((item) => !item.isAssigned && !item.reservedOrderId).length, 1);
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

test('Expiry cleanup uses timestamp values and releases expired-order reservations', () => {
  const now = new Date('2026-10-27T12:30:00.000Z');
  const rows = [
    { id: 'expired', status: 'utr_submitted', expiresAt: new Date('2026-10-27T12:29:00.000Z') },
    { id: 'active', status: 'utr_submitted', expiresAt: new Date('2026-10-27T12:31:00.000Z') },
  ];
  const vault: { poolType: string; isAssigned: boolean; reservedOrderId?: string }[] = [
    { poolType: 'permanent', isAssigned: false, reservedOrderId: 'expired' },
    { poolType: 'permanent', isAssigned: false, reservedOrderId: 'active' },
  ];
  for (const row of rows) {
    if (isOrderExpired(row.expiresAt, now.getTime())) {
      row.status = 'expired';
      releaseStock(vault, row.id);
    }
  }

  assert.equal(rows[0].status, 'expired');
  assert.equal(rows[1].status, 'utr_submitted');
  assert.equal(vault.find((item) => item.reservedOrderId === 'expired'), undefined);
  assert.equal(vault.find((item) => item.reservedOrderId === 'active')?.reservedOrderId, 'active');
});
