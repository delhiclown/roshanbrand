import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverOnce, submitUtr, type DeliveryState } from '../src/paymentDelivery.ts';

test('Submitting a UTR never marks an order paid or delivers credentials', () => {
  const state: DeliveryState = { delivered: false, status: 'pending' };
  assert.equal(submitUtr(state), true);
  assert.deepEqual(state, { delivered: false, status: 'utr_submitted' });
});

test('Manual approval delivers an ID only once', () => {
  const state: DeliveryState = { delivered: false, status: 'utr_submitted' };
  let deliveryCount = 0;
  const deliverOrder = () => {
    deliveryCount += 1;
    return true;
  };

  assert.equal(deliverOnce(state, 'manual', deliverOrder), 'delivered');
  assert.equal(deliverOnce(state, 'manual', deliverOrder), 'already-delivered');
  assert.equal(deliveryCount, 1);
  assert.deepEqual(state, { delivered: true, status: 'paid' });
});

test('A failed delivery leaves the order eligible for retry', () => {
  const state: DeliveryState = { delivered: false, status: 'pending' };

  assert.equal(deliverOnce(state, 'manual', () => false), 'unavailable');
  assert.deepEqual(state, { delivered: false, status: 'pending' });
});
