import React, { useState, useEffect, useRef, useCallback } from 'react';

interface WireGuardPeer {
  publicKey: string;
  endpoint: string | null;
  allowedIPs: string | null;
  latestHandshake: number;
  transferRx: number;
  transferTx: number;
}

interface WireGuardConfig {
  name: string;
  address: string | null;
  dns: string | null;
  listenPort: number | null;
  peers: { publicKey: string; endpoint: string | null; allowedIPs: string | null }[];
}

interface WireGuardStatus {
  active: boolean;
  enabled: boolean;
  interface: string | null;
  address: string | null;
  listenPort: number | null;
  dns: string | null;
  peer: WireGuardPeer | null;
  config: WireGuardConfig | null;
  configText: string | null;
  savedRoute: { gateway: string; dev: string } | null;
  dependencies: { installed: boolean; message?: string };
}

const WireGuardSettings: React.FC = () => {
  const [status, setStatus] = useState<WireGuardStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [configText, setConfigText] = useState('');
  const [inputMode, setInputMode] = useState<'paste' | 'upload'>('paste');
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showToggleConfirm, setShowToggleConfirm] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<boolean | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const token = localStorage.getItem('rjd_admin_token');
      const res = await fetch('/api/wireguard/status', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data: WireGuardStatus = await res.json();
      setStatus(data);
    } catch (e: any) {
      console.error('Failed to fetch WireGuard status:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  // Poll status every 5s when active
  useEffect(() => {
    if (status?.active) {
      pollRef.current = setInterval(fetchStatus, 5000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [status?.active, fetchStatus]);

  const handleToggle = (enable: boolean) => {
    setPendingToggle(enable);
    setShowToggleConfirm(true);
  };

  const confirmToggle = async () => {
    if (pendingToggle === null) return;
    setShowToggleConfirm(false);
    setToggling(true);
    setMessage(null);

    try {
      const token = localStorage.getItem('rjd_admin_token');
      const res = await fetch('/api/wireguard/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ enabled: pendingToggle })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Toggle failed');
      }

      setMessage({
        type: 'success',
        text: pendingToggle ? 'WireGuard VPN activated — all traffic routed through tunnel' : 'WireGuard VPN deactivated — original route restored'
      });

      await fetchStatus();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Failed to toggle WireGuard' });
    } finally {
      setToggling(false);
      setPendingToggle(null);
    }
  };

  const handleSaveConfig = async () => {
    if (!configText.trim()) {
      setMessage({ type: 'error', text: 'Please paste a WireGuard configuration or upload a .conf file' });
      return;
    }

    setMessage(null);
    setLoading(true);

    try {
      const token = localStorage.getItem('rjd_admin_token');
      const res = await fetch('/api/wireguard/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ configText })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save configuration');
      }

      setMessage({ type: 'success', text: 'Configuration saved successfully' });
      setConfigText('');
      await fetchStatus();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Failed to save configuration' });
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setConfigText(text);
      setInputMode('paste');
      setMessage({ type: 'success', text: `File "${file.name}" loaded — click Save to upload` });
    };
    reader.readAsText(file);
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    setMessage(null);
    setLoading(true);

    try {
      const token = localStorage.getItem('rjd_admin_token');
      const res = await fetch('/api/wireguard/config', {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete configuration');
      }

      setMessage({ type: 'success', text: 'Configuration deleted' });
      await fetchStatus();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Failed to delete configuration' });
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const token = localStorage.getItem('rjd_admin_token');
      const res = await fetch('/api/wireguard/log', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (e) {
      console.error('Failed to fetch logs:', e);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  const formatHandshakeAge = (timestamp: number): string => {
    if (!timestamp) return 'Never';
    const age = Math.floor(Date.now() / 1000) - timestamp;
    if (age < 0) return 'Unknown';
    if (age < 60) return `${age}s ago`;
    if (age < 3600) return `${Math.floor(age / 60)}m ago`;
    if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
    return `${Math.floor(age / 86400)}d ago`;
  };

  const isHandshakeStale = (timestamp: number): boolean => {
    if (!timestamp) return true;
    const age = Math.floor(Date.now() / 1000) - timestamp;
    return age > 180; // 3 minutes
  };

  if (loading && !status) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  const hasConfig = !!status?.config;
  const depsInstalled = status?.dependencies?.installed !== false;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center gap-2">
        <span>🔒</span> WireGuard VPN
      </h2>

      {/* Message Banner */}
      {message && (
        <div className={`mb-4 p-4 rounded-lg flex items-center justify-between ${
          message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
          message.type === 'warning' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' :
          'bg-red-50 text-red-700 border border-red-200'
        }`}>
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="ml-4 font-bold hover:opacity-70">&times;</button>
        </div>
      )}

      {/* Dependency Warning */}
      {!depsInstalled && (
        <div className="mb-4 p-4 rounded-lg bg-red-50 text-red-700 border border-red-200">
          <p className="font-semibold">WireGuard Not Installed</p>
          <p className="text-sm mt-1">{status?.dependencies?.message || 'Install wireguard-tools on this device'}</p>
          <code className="mt-2 block bg-red-100 p-2 rounded text-xs">sudo apt install wireguard-tools</code>
        </div>
      )}

      {/* Status Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${status?.active ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
            <span className={`text-lg font-semibold ${status?.active ? 'text-green-700' : 'text-gray-500'}`}>
              {status?.active ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          {/* Toggle Switch */}
          {hasConfig && depsInstalled && (
            <button
              onClick={() => handleToggle(!status?.active)}
              disabled={toggling}
              className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                status?.active ? 'bg-green-500' : 'bg-gray-300'
              } ${toggling ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                status?.active ? 'translate-x-8' : 'translate-x-1'
              }`} />
            </button>
          )}
        </div>

        {/* Connection Details */}
        {status?.active && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Interface:</span>
              <span className="ml-2 font-mono font-medium">{status.interface}</span>
            </div>
            <div>
              <span className="text-gray-500">Address:</span>
              <span className="ml-2 font-mono font-medium">{status.address}</span>
            </div>
            {status.dns && (
              <div>
                <span className="text-gray-500">DNS:</span>
                <span className="ml-2 font-mono font-medium">{status.dns}</span>
              </div>
            )}
            {status.listenPort && (
              <div>
                <span className="text-gray-500">Listen Port:</span>
                <span className="ml-2 font-mono font-medium">{status.listenPort}</span>
              </div>
            )}
          </div>
        )}

        {/* Peer Statistics */}
        {status?.active && status.peer && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Peer Statistics</h4>
            <div className="grid grid-cols-1 gap-2 text-sm">
              {status.peer.endpoint && (
                <div>
                  <span className="text-gray-500">Endpoint:</span>
                  <span className="ml-2 font-mono">{status.peer.endpoint}</span>
                </div>
              )}
              <div className="flex gap-6">
                <div>
                  <span className="text-gray-500">Received:</span>
                  <span className="ml-2 font-mono text-green-600">↓ {formatBytes(status.peer.transferRx)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Sent:</span>
                  <span className="ml-2 font-mono text-blue-600">↑ {formatBytes(status.peer.transferTx)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Last Handshake:</span>
                <span className={`font-mono ${isHandshakeStale(status.peer.latestHandshake) ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                  {formatHandshakeAge(status.peer.latestHandshake)}
                </span>
                {isHandshakeStale(status.peer.latestHandshake) && status.peer.latestHandshake > 0 && (
                  <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Stale</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Default Route Info */}
        {status?.active && status.savedRoute && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Default Route</h4>
            <div className="text-sm space-y-1">
              <div>
                <span className="text-gray-500">Current:</span>
                <span className="ml-2 font-mono text-green-600">{status.interface} (VPN)</span>
              </div>
              <div>
                <span className="text-gray-500">Original:</span>
                <span className="ml-2 font-mono text-gray-600">
                  {status.savedRoute.dev} via {status.savedRoute.gateway}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Configuration Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Configuration</h3>

        {hasConfig ? (
          <>
            {/* Show current config summary */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">Interface:</span>
                  <span className="ml-2 font-mono">{status?.config?.name || 'wg0'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Address:</span>
                  <span className="ml-2 font-mono">{status?.config?.address || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Peers:</span>
                  <span className="ml-2 font-mono">{status?.config?.peers?.length || 0}</span>
                </div>
                {status?.config?.dns && (
                  <div>
                    <span className="text-gray-500">DNS:</span>
                    <span className="ml-2 font-mono">{status.config.dns}</span>
                  </div>
                )}
              </div>

              {/* Peer list */}
              {status?.config?.peers && status.config.peers.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  {status.config.peers.map((peer, i) => (
                    <div key={i} className="text-xs text-gray-600 mb-1">
                      <span className="font-mono">{peer.publicKey?.slice(0, 16)}...</span>
                      {peer.endpoint && <span className="ml-2 text-gray-400">→ {peer.endpoint}</span>}
                      {peer.allowedIPs && <span className="ml-2 text-gray-400">[{peer.allowedIPs}]</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Replace config */}
            <details className="mb-4">
              <summary className="cursor-pointer text-sm text-blue-600 hover:text-blue-700 font-medium">
                Replace Configuration
              </summary>
              <div className="mt-3">
                {renderConfigInput()}
              </div>
            </details>

            {/* Delete button */}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={status?.active || false}
              className="px-4 py-2 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status?.active ? 'Deactivate VPN before deleting' : 'Delete Configuration'}
            </button>
          </>
        ) : (
          renderConfigInput()
        )}
      </div>

      {/* Logs Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Logs</h3>
          <div className="flex gap-2">
            <button
              onClick={() => { fetchLogs(); setShowLogs(true); }}
              className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {showLogs ? 'Refresh' : 'Show Logs'}
            </button>
            {showLogs && (
              <button
                onClick={() => setShowLogs(false)}
                className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Hide
              </button>
            )}
          </div>
        </div>

        {showLogs && (
          <div className="bg-gray-900 rounded-lg p-4 max-h-64 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-gray-500 text-sm">No logs available</p>
            ) : (
              <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                {logs.join('\n')}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Toggle Confirmation Modal */}
      {showToggleConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">
              {pendingToggle ? 'Activate WireGuard VPN?' : 'Deactivate WireGuard VPN?'}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {pendingToggle
                ? 'This will route ALL device traffic through the VPN tunnel. The original route will be saved and restored when deactivated.'
                : 'This will restore the original default route and disconnect the VPN tunnel.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowToggleConfirm(false); setPendingToggle(null); }}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={confirmToggle}
                className={`px-4 py-2 text-sm text-white rounded-lg ${
                  pendingToggle ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {pendingToggle ? 'Activate' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Delete Configuration?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will permanently remove the WireGuard configuration. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function renderConfigInput() {
    return (
      <div>
        {/* Mode Toggle */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setInputMode('paste')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              inputMode === 'paste' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Paste Configuration
          </button>
          <button
            onClick={() => setInputMode('upload')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              inputMode === 'upload' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Upload .conf File
          </button>
        </div>

        {inputMode === 'upload' ? (
          <div className="mb-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <p className="text-gray-500 text-sm">Click to upload or drag a .conf file here</p>
              <p className="text-gray-400 text-xs mt-1">WireGuard configuration file</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".conf"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        ) : null}

        {/* Text Area (always shown for editing) */}
        <textarea
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          placeholder={`[Interface]\nPrivateKey = <your-private-key>\nAddress = 10.0.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = <server-public-key>\nEndpoint = vpn.example.com:51820\nAllowedIPs = 0.0.0.0/0`}
          className="w-full h-48 px-4 py-3 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-y"
          spellCheck={false}
        />

        <button
          onClick={handleSaveConfig}
          disabled={loading || !configText.trim()}
          className="mt-3 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    );
  }
};

export default WireGuardSettings;
