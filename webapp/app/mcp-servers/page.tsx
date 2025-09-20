"use client";

import React from 'react';
import {
  fetchMcpServers,
  fetchMcpServer,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  reloadMcpServers,
  type McpServerItem,
} from '../../lib/mcp-servers-client';

type EditingState = {
  name: string;
  url: string;
  type: 'streamable-http';
  description: string;
  note: string;
  enabled: boolean;
  updated_at?: number;
};

const emptyEditing: EditingState = {
  name: '',
  url: '',
  type: 'streamable-http',
  description: '',
  note: '',
  enabled: true,
};

function toEditing(item: McpServerItem): EditingState {
  return {
    name: item.name || '',
    url: item.url || '',
    type: item.type || 'streamable-http',
    description: item.description || '',
    note: item.note || '',
    enabled: item.enabled !== false,
    updated_at: item.updated_at,
  };
}

export default function McpServersPage() {
  const [items, setItems] = React.useState<McpServerItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<EditingState>(emptyEditing);
  const [isNew, setIsNew] = React.useState(false);
  const [loadingList, setLoadingList] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);

  const loadList = React.useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await fetchMcpServers();
      setItems(list);
      return list;
    } catch (err: any) {
      setError(err?.message || 'Failed to load MCP servers');
      return [] as McpServerItem[];
    } finally {
      setLoadingList(false);
    }
  }, []);

  React.useEffect(() => {
    void loadList();
  }, [loadList]);

  const selectItem = async (id: string) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    setIsNew(false);
    setSelectedId(id);
    try {
      const item = await fetchMcpServer(id);
      setEditing(toEditing(item));
    } catch (err: any) {
      setError(err?.message || 'Failed to load MCP server');
    } finally {
      setBusy(false);
    }
  };

  const startNew = () => {
    setSelectedId('__new__');
    setIsNew(true);
    setEditing({ ...emptyEditing });
    setStatus(null);
    setError(null);
  };

  const onSave = async () => {
    if (!editing.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!editing.url.trim()) {
      setError('URL is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isNew || !selectedId || selectedId === '__new__') {
        const created = await createMcpServer({
          name: editing.name,
          url: editing.url,
          type: editing.type,
          description: editing.description || undefined,
          note: editing.note || undefined,
          enabled: editing.enabled,
        });
        setStatus(`Created ${created.name}`);
        setIsNew(false);
        setSelectedId(created.id);
        setEditing(toEditing(created));
      } else {
        const updated = await updateMcpServer(selectedId, {
          name: editing.name,
          url: editing.url,
          type: editing.type,
          description: editing.description.trim() ? editing.description : null,
          note: editing.note.trim() ? editing.note : null,
          enabled: editing.enabled,
        });
        setStatus(`Saved ${updated.name}`);
        setEditing(toEditing(updated));
      }
      await loadList();
    } catch (err: any) {
      setError(err?.message || 'Failed to save MCP server');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!selectedId || isNew) return;
    if (!window.confirm('Delete this MCP server configuration?')) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await deleteMcpServer(selectedId);
      setStatus('Deleted MCP server');
      setSelectedId(null);
      setIsNew(false);
      setEditing({ ...emptyEditing });
      await loadList();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete MCP server');
    } finally {
      setBusy(false);
    }
  };

  const onReload = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const summary = await reloadMcpServers();
      setStatus(
        `Reloaded MCP servers: ${summary.serverCount}/${summary.attempted} connected, ${summary.toolCount} tool(s), ${summary.failed} failed.`
      );
      await loadList();
    } catch (err: any) {
      setError(err?.message || 'Failed to reload MCP servers');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Remote MCP Servers</h1>
          <p className="text-sm text-gray-500">Manage runtime configuration for remote MCP server connections.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadList()}
            className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm"
            disabled={loadingList || busy}
          >
            {loadingList ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={startNew}
            className="px-3 py-1 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
            disabled={busy}
          >
            Add server
          </button>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
      {status && <div className="p-3 bg-green-50 text-green-700 rounded text-sm">{status}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">Configured servers</span>
            {loadingList && <span className="text-xs text-gray-400">Loading…</span>}
          </div>
          <ul className="divide-y rounded border bg-white">
            {items.length === 0 && !loadingList ? (
              <li className="p-3 text-sm text-gray-500">No MCP servers configured.</li>
            ) : (
              items.map((item) => {
                const selected = selectedId === item.id;
                return (
                  <li
                    key={item.id}
                    className={`p-3 cursor-pointer hover:bg-gray-50 flex items-center justify-between ${selected ? 'bg-blue-50' : ''}`}
                    onClick={() => void selectItem(item.id)}
                  >
                    <div>
                      <div className="font-medium">
                        {item.name}
                        <span className="text-xs text-gray-400 ml-2">{item.id}</span>
                      </div>
                      <div className="text-xs text-gray-500 break-all">{item.url}</div>
                      {item.note && <div className="text-xs text-gray-500 line-clamp-1" title={item.note}>{item.note}</div>}
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${item.enabled !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                    >
                      {item.enabled !== false ? 'Enabled' : 'Disabled'}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
        <div>
          <div className="text-sm text-gray-500 mb-2">Edit configuration</div>
          {selectedId ? (
            <div className="space-y-3">
              <div className="text-xs text-gray-500">Editing ID: <code>{selectedId === '__new__' ? '(new)' : selectedId}</code></div>
              {editing.updated_at && (
                <div className="text-xs text-gray-400">
                  Last updated: {new Date(editing.updated_at).toLocaleString()}
                </div>
              )}
              <label className="block text-sm">
                Name
                <input
                  className="mt-1 w-full border rounded p-2"
                  value={editing.name}
                  onChange={(e) => setEditing((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={busy}
                />
              </label>
              <label className="block text-sm">
                URL
                <input
                  className="mt-1 w-full border rounded p-2"
                  value={editing.url}
                  onChange={(e) => setEditing((prev) => ({ ...prev, url: e.target.value }))}
                  disabled={busy}
                />
              </label>
              <div className="text-xs text-gray-500">Type: streamable-http</div>
              <label className="block text-sm">
                Description
                <textarea
                  className="mt-1 w-full border rounded p-2 h-24"
                  value={editing.description}
                  onChange={(e) => setEditing((prev) => ({ ...prev, description: e.target.value }))}
                  disabled={busy}
                />
              </label>
              <label className="block text-sm">
                Note
                <textarea
                  className="mt-1 w-full border rounded p-2 h-20"
                  value={editing.note}
                  onChange={(e) => setEditing((prev) => ({ ...prev, note: e.target.value }))}
                  disabled={busy}
                />
              </label>
              <label className="inline-flex items-center space-x-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(e) => setEditing((prev) => ({ ...prev, enabled: e.target.checked }))}
                  disabled={busy}
                />
                <span>Enabled</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void onSave()}
                  disabled={busy}
                  className="px-3 py-1 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
                >
                  {busy ? 'Working…' : 'Save'}
                </button>
                {!isNew && (
                  <button
                    onClick={() => void onDelete()}
                    disabled={busy}
                    className="px-3 py-1 rounded bg-red-100 text-red-600 text-sm disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
                <button
                  onClick={() => void onReload()}
                  disabled={busy}
                  className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm disabled:opacity-50"
                >
                  {busy ? 'Working…' : 'Reload MCP tools'}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              Select a server from the list or create a new one to edit configuration.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
