"use client";
import React from 'react';
import { fetchAdaptations, fetchAdaptation, updateAdaptation, reloadAdaptations, AdaptationItem } from '../../lib/adaptations-client';

export default function AdaptationsPage() {
  const [items, setItems] = React.useState<AdaptationItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ title?: string; content?: string; enabled?: boolean }>({});

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const list = await fetchAdaptations();
      setItems(list);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const onSelect = async (id: string) => {
    setSelectedId(id);
    try {
      const it = await fetchAdaptation(id);
      setEditing({ title: it.title, content: it.content, enabled: it.enabled !== false });
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onSave = async () => {
    if (!selectedId) return;
    setLoading(true); setError(null);
    try {
      await updateAdaptation(selectedId, editing);
      await reloadAdaptations();
      await load();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Prompt Adaptations</h1>
        <button onClick={() => void load()} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm">Refresh</button>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="text-sm text-gray-500 mb-2">Available items</div>
          <ul className="divide-y rounded border">
            {items.map((it) => (
              <li key={it.id} className="p-3 cursor-pointer hover:bg-gray-50 flex items-center justify-between" onClick={() => void onSelect(it.id)}>
                <div>
                  <div className="font-medium">{it.title} <span className="text-xs text-gray-400">({it.id})</span></div>
                  {it.description && <div className="text-xs text-gray-500 line-clamp-1" title={it.description}>{it.description}</div>}
                  <div className="text-xs text-gray-500">enabled: {it.enabled !== false ? 'true' : 'false'} · scope: {it.scope.global ? 'global' : `${(it.scope.agents||[]).join('/') || 'any'}/${(it.scope.channels||[]).join('/') || 'any'}`}</div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${it.enabled !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{it.enabled !== false ? 'Enabled' : 'Disabled'}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-sm text-gray-500 mb-2">Edit selected</div>
          {selectedId ? (
            <div className="space-y-3">
              <div className="text-xs text-gray-500">Editing: <code>{selectedId}</code></div>
              {(() => { const sel = items.find(i => i.id === selectedId); return sel?.description ? <div className="text-xs text-gray-600 bg-gray-50 border rounded p-2">{sel.description}</div> : null; })()}
              <label className="block text-sm">Title
                <input className="mt-1 w-full border rounded p-2" value={editing.title || ''} onChange={(e) => setEditing((s) => ({ ...s, title: e.target.value }))} />
              </label>
              <label className="block text-sm">Content
                <textarea className="mt-1 w-full border rounded p-2 h-40" value={editing.content || ''} onChange={(e) => setEditing((s) => ({ ...s, content: e.target.value }))} />
              </label>
              <label className="inline-flex items-center space-x-2 text-sm"><input type="checkbox" checked={editing.enabled !== false} onChange={(e) => setEditing((s) => ({ ...s, enabled: e.target.checked }))} /><span>Enabled</span></label>
              <div className="flex gap-2">
                <button disabled={loading} onClick={() => void onSave()} className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50">Save</button>
                <button disabled={loading} onClick={async () => { await reloadAdaptations(); await load(); }} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">Reload</button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">Select an item from the left to edit.</div>
          )}
        </div>
      </div>
    </div>
  );
}
