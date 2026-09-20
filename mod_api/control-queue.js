'use strict';
const { randomUUID } = require('crypto');
const schema = require('./control-schema.js');

// An action leaving the queue is only dispatched, never implicitly successful.
// Dispatched actions are never retried: a lost response may have followed a purchase.
function createQueue({ maxPending = 1000, maxHistory = 200 } = {}) {
  const pending = [], records = new Map(), order = [];
  function trim() {
    for (let i = 0; records.size > maxHistory + pending.length && i < order.length;) {
      const id = order[i], record = records.get(id);
      if (!['queued', 'dispatched'].includes(record.status)) { records.delete(id); order.splice(i, 1); }
      else i++;
    }
  }
  function enqueue(input, options = {}) {
    if (pending.length >= maxPending || Array.from(records.values()).filter(r => r.status === 'dispatched').length >= maxHistory) {
      const e = new Error('Action queue is full or has too many unacknowledged actions.'); e.status = 429; throw e;
    }
    let action;
    try { action = schema.validate(input); } catch (e) { e.status = 400; throw e; }
    const id = randomUUID(), queuedAt = Date.now();
    const envelope = { ...action, _bridge: { id, queued_at: queuedAt, expires_at: queuedAt + (options.ttl_ms || 30000) } };
    const record = { id, type: action.type, status: 'queued', queued_at: queuedAt, expires_at: envelope._bridge.expires_at };
    records.set(id, record); order.push(id); pending.push(envelope); trim();
    return { ok: true, id, type: action.type, status: 'queued', position: pending.length, expires_at: record.expires_at };
  }
  function next() {
    // Preserve FIFO for reproducible multi-step workflows.
    while (pending.length) {
      const action = pending.shift(), record = records.get(action._bridge.id);
      if (Date.now() > record.expires_at) { record.status = 'expired'; record.finished_at = Date.now(); continue; }
      record.status = 'dispatched'; record.dispatched_at = Date.now(); return action;
    }
    trim(); return null;
  }
  function acknowledge(receipts) {
    if (!Array.isArray(receipts) || receipts.length > 1000) { const e = new Error('results must be an array of at most 1000 receipts'); e.status = 400; throw e; }
    // Validate the whole batch before committing any result.
    receipts.forEach(receipt => {
      const record = receipt && records.get(receipt.id);
      if (!receipt || typeof receipt.id !== 'string' || !['succeeded', 'failed', 'awaiting_confirmation'].includes(receipt.status) || (record && record.type !== receipt.type)) {
        const e = new Error('Unknown or invalid action receipt.'); e.status = 400; throw e;
      }
      if (!record) return; // A page can retain receipts after the main server restarts.
      if (record.status === 'queued' || record.status === 'cancelled' || record.status === 'expired') { const e = new Error('Action was not dispatched.'); e.status = 409; throw e; }
    });
    receipts.forEach(receipt => {
      const record = records.get(receipt.id);
      if (!record || record.status !== 'dispatched') return; // idempotent receipt replay
      Object.assign(record, { status: receipt.status, started_at: receipt.started_at, finished_at: receipt.finished_at,
        _executed_at: receipt.finished_at, result: receipt.result, error: receipt.error });
    });
    const orphaned = receipts.filter(r => !records.has(r.id)).map(r => r.id);
    trim(); return { ok: true, acknowledged: receipts.map(r => r.id), orphaned };
  }
  function get(id) { return records.get(id) || null; }
  function history(count) { return order.slice(-count).map(id => records.get(id)); }
  function clear() {
    const cancelled = pending.splice(0).map(action => action._bridge.id);
    cancelled.forEach(id => Object.assign(records.get(id), { status: 'cancelled', finished_at: Date.now() }));
    trim(); return { ok: true, cancelled, count: cancelled.length };
  }
  return {enqueue, next, acknowledge, get, history, clear, view: () => ({total: pending.length, fila: pending.map(a => ({...a, save: a.save ? '[redacted]' : undefined, code: a.code ? '[redacted]' : undefined}))})};
}
module.exports = { createQueue };
