import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverOnce, type DeliveryState } from '../src/paymentDelivery.ts';

function createDeliveryHarness() {
  const state: DeliveryState = { delivered: false, status: 'pending' };
  const deliverySources: string[] = [];
  const deliverOrder = (source: 'sms' | 'manual') => {
    deliverySources.push(source);
    return true;
  };
  return {
    state,
    smsPayment: () => deliverOnce(state, 'sms', deliverOrder),
    manualPayment: () => deliverOnce(state, 'manual', deliverOrder),
    get deliverySources() { return deliverySources; },
  };
}

test('SMS delivery followed by manual payment delivers the ID only once', () => {
  const harness = createDeliveryHarness();

  assert.equal(harness.smsPayment(), 'delivered');
  assert.equal(harness.manualPayment(), 'already-delivered');
  assert.deepEqual(harness.deliverySources, ['sms']);
  assert.equal(harness.state.status, 'paid');
});

test('Manual payment followed by a late SMS delivers the ID only once', () => {
  const harness = createDeliveryHarness();

  assert.equal(harness.manualPayment(), 'delivered');
  assert.equal(harness.smsPayment(), 'already-delivered');
  assert.deepEqual(harness.deliverySources, ['manual']);
  assert.equal(harness.state.status, 'paid');
});

test('A failed delivery leaves the order eligible for retry', () => {
  const state: DeliveryState = { delivered: false, status: 'pending' };

  assert.equal(deliverOnce(state, 'manual', () => false), 'unavailable');
  assert.deepEqual(state, { delivered: false, status: 'pending' });
});
