/**
 * Fila offline — armazena requisições quando a API está indisponível.
 */
const fs = require('fs');
const path = require('path');
const { getConfigPath } = require('./config');

const MAX_QUEUE = 500;

function getQueuePath() {
  const configDir = path.dirname(getConfigPath());
  return path.join(configDir, 'offline-queue.json');
}

function loadQueue() {
  const file = getQueuePath();
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveQueue(items) {
  const file = getQueuePath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(items.slice(-MAX_QUEUE), null, 0));
}

function enqueue(item) {
  const queue = loadQueue();
  queue.push({ ...item, queuedAt: new Date().toISOString() });
  saveQueue(queue);
}

async function flushQueue(requestFn) {
  const queue = loadQueue();
  if (queue.length === 0) return 0;

  const remaining = [];
  let sent = 0;

  for (const item of queue) {
    try {
      await requestFn(item.method, item.path, item.body);
      sent++;
    } catch {
      remaining.push(item);
    }
  }

  saveQueue(remaining);
  return sent;
}

function queueSize() {
  return loadQueue().length;
}

module.exports = { enqueue, flushQueue, queueSize };
