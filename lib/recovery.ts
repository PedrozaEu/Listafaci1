import { loadCache, listOps, outboxAvailable } from '@/data/outbox';
import { snapshotOf } from '@/lib/backup';
import { STORAGE_VERSION } from '@/lib/migrations';
import { useStore } from '@/store/useStore';

/**
 * Local recovery file for the signed-in account: screen state, confirmed cache and every queued operation
 * (pending, conflict, denied), with a SHA-256 of the content. Contains no tokens, cookies or keys.
 */
export async function buildRecovery(userId: string) {
  const cache = outboxAvailable() ? await loadCache(userId).catch(() => null) : null;
  const ops = outboxAvailable() ? await listOps(userId).catch(() => []) : [];
  const content = {
    kind: 'listafacil-recuperacao', schemaVersion: STORAGE_VERSION, exportedAt: new Date().toISOString(), userId,
    local: snapshotOf(useStore.getState()), confirmed: cache?.confirmed ?? null, cacheLocal: cache?.local ?? null,
    ops: ops.map(o => ({ ...o })),
  };
  const text = JSON.stringify(content);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const sha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { content, sha256, file: JSON.stringify({ sha256, content }, null, 2) };
}

export async function downloadRecovery(userId: string) {
  const { file } = await buildRecovery(userId);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([file], { type: 'application/json' }));
  a.download = `listafacil-recuperacao-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
