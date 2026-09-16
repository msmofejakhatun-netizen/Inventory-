import React, { useEffect, useState, useMemo } from 'react';
import {
  History,
  Search,
  Filter,
  Download,
  Calendar,
  User,
  Shield,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  FileText,
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { AuditLog } from '../types';
import { Badge } from '../components/common/Badge';
import { exportToCsv } from '../services/exportService';

export const AuditLogsView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, activeRole, hasRole } = useAuth();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAction, setSelectedAction] = useState<string>('ALL');
  const [selectedEntity, setSelectedEntity] = useState<string>('ALL');
  const [selectedUser, setSelectedUser] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<string>('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Security authorization check: Only OWNER or MANAGER
  const isAuthorized = hasRole(['OWNER', 'MANAGER']);

  useEffect(() => {
    if (!activeRestaurantId || !isAuthorized) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'restaurants', activeRestaurantId, 'auditLogs'),
      orderBy('createdAt', 'desc'),
      limit(500)
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const auditList = snap.docs.map((doc) => doc.data() as AuditLog);
        setLogs(auditList);
        setLoading(false);
      },
      (err) => {
        console.error('Failed to load audit logs:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [activeRestaurantId, isAuthorized]);

  // Unique actions and entities for filter dropdowns
  const uniqueActions = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => l.action && set.add(l.action));
    return Array.from(set).sort();
  }, [logs]);

  const uniqueEntities = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => l.entity && set.add(l.entity));
    return Array.from(set).sort();
  }, [logs]);

  const uniqueUsers = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => l.actorName && set.add(l.actorName));
    return Array.from(set).sort();
  }, [logs]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Search term
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesActor = log.actorName?.toLowerCase().includes(term);
        const matchesAction = log.action?.toLowerCase().includes(term);
        const matchesEntity = log.entity?.toLowerCase().includes(term);
        const matchesDetails = log.details?.toLowerCase().includes(term);
        const matchesId = log.entityId?.toLowerCase().includes(term);
        if (!matchesActor && !matchesAction && !matchesEntity && !matchesDetails && !matchesId) {
          return false;
        }
      }

      // Action filter
      if (selectedAction !== 'ALL' && log.action !== selectedAction) {
        return false;
      }

      // Entity filter
      if (selectedEntity !== 'ALL' && log.entity !== selectedEntity) {
        return false;
      }

      // User filter
      if (selectedUser !== 'ALL' && log.actorName !== selectedUser) {
        return false;
      }

      // Date filter (YYYY-MM-DD)
      if (dateFilter) {
        if (!log.createdAt.startsWith(dateFilter)) {
          return false;
        }
      }

      return true;
    });
  }, [logs, searchTerm, selectedAction, selectedEntity, selectedUser, dateFilter]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredLogs.slice(start, start + pageSize);
  }, [filteredLogs, currentPage, pageSize]);

  // Reset page when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedAction, selectedEntity, selectedUser, dateFilter]);

  const handleExportCsv = () => {
    const headers = ['Date', 'Time', 'User', 'User UID', 'Action', 'Entity', 'Entity ID', 'Details'];
    const rows = filteredLogs.map((l) => {
      const dt = new Date(l.createdAt);
      return [
        dt.toLocaleDateString(),
        dt.toLocaleTimeString(),
        l.actorName || 'Unknown',
        l.actorUid || '—',
        l.action || '—',
        l.entity || '—',
        l.entityId || '—',
        l.details || '—',
      ];
    });

    exportToCsv(`audit_logs_${activeRestaurant?.name || 'store'}`, headers, rows);
  };

  // If unauthorized
  if (!isAuthorized) {
    return (
      <div className="bg-white rounded-xl border border-stone-200 p-12 text-center shadow-2xs max-w-lg mx-auto">
        <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4 border border-rose-200">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-stone-900">Access Restricted</h2>
        <p className="text-xs text-stone-500 mt-2">
          The immutable Store Audit Trail contains sensitive transactional records and is accessible only to{' '}
          <strong className="text-stone-800">Restaurant Owners and General Managers</strong>.
        </p>
        <p className="text-[11px] text-stone-400 mt-1 font-mono">Current Active Role: {activeRole || 'STAFF'}</p>
      </div>
    );
  }

  const getActionBadgeVariant = (action: string) => {
    const a = action.toUpperCase();
    if (a.includes('DELETE') || a.includes('WASTAGE') || a.includes('EMERGENCY')) return 'danger';
    if (a.includes('PURCHASE') || a.includes('CREATE') || a.includes('PAYMENT')) return 'success';
    if (a.includes('UPDATE') || a.includes('ADJUST') || a.includes('AUDIT')) return 'warning';
    return 'neutral';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">Store Audit Trail</h1>
            <Badge variant="neutral" size="sm">
              Immutable Log
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Tamper-proof compliance log tracking all stock adjustments, purchases, issues, wastage, and master alterations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={filteredLogs.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-lg text-xs font-semibold disabled:opacity-50 transition-colors shadow-2xs"
          >
            <Download className="w-3.5 h-3.5" /> Export Audit CSV
          </button>
        </div>
      </div>

      {/* Filters Card */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search box */}
          <div className="relative lg:col-span-2">
            <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search user, action, entity, details..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-900 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {/* Action Filter */}
          <div>
            <select
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value)}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-800 font-medium focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            >
              <option value="ALL">All Actions ({uniqueActions.length})</option>
              {uniqueActions.map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
            </select>
          </div>

          {/* Entity Filter */}
          <div>
            <select
              value={selectedEntity}
              onChange={(e) => setSelectedEntity(e.target.value)}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-800 font-medium focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            >
              <option value="ALL">All Entities ({uniqueEntities.length})</option>
              {uniqueEntities.map((ent) => (
                <option key={ent} value={ent}>
                  {ent}
                </option>
              ))}
            </select>
          </div>

          {/* Date Filter */}
          <div>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-800 font-medium focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            />
          </div>
        </div>

        {/* Clear Filters Button if any active */}
        {(searchTerm || selectedAction !== 'ALL' || selectedEntity !== 'ALL' || selectedUser !== 'ALL' || dateFilter) && (
          <div className="flex items-center justify-between pt-2 border-t border-stone-100 text-xs text-stone-500">
            <span>Showing {filteredLogs.length} matching audit events</span>
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedAction('ALL');
                setSelectedEntity('ALL');
                setSelectedUser('ALL');
                setDateFilter('');
              }}
              className="text-amber-700 hover:text-amber-800 font-semibold"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-stone-50 text-stone-600 font-semibold uppercase tracking-wider text-[11px] border-b border-stone-200">
              <tr>
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Entity</th>
                <th className="py-3 px-4">Entity ID</th>
                <th className="py-3 px-4">Details / Changes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 text-stone-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-stone-400">
                    Loading audit trail from Firestore...
                  </td>
                </tr>
              ) : paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-stone-400">
                    No audit records matching criteria.
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((log) => {
                  const dt = new Date(log.createdAt);
                  return (
                    <tr key={log.id} className="hover:bg-stone-50/70 transition-colors">
                      {/* Timestamp */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono text-stone-900 font-medium">{dt.toLocaleDateString()}</div>
                        <div className="text-[11px] text-stone-400 font-mono">{dt.toLocaleTimeString()}</div>
                      </td>

                      {/* User */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-semibold text-stone-900">{log.actorName || 'System'}</div>
                        <div className="text-[10px] text-stone-400 font-mono truncate max-w-[120px]" title={log.actorUid}>
                          {log.actorUid || 'system'}
                        </div>
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <Badge variant={getActionBadgeVariant(log.action)} size="sm">
                          {log.action}
                        </Badge>
                      </td>

                      {/* Entity */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-medium text-stone-800 bg-stone-100 px-2 py-0.5 rounded text-[11px]">
                          {log.entity}
                        </span>
                      </td>

                      {/* Entity ID */}
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-stone-500 text-[11px]">
                        {log.entityId ? (
                          <span className="truncate max-w-[100px] inline-block" title={log.entityId}>
                            {log.entityId.slice(0, 10)}...
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>

                      {/* Details / Values */}
                      <td className="py-3 px-4 text-stone-600 text-xs">
                        <div className="max-w-md break-words">{log.details || '—'}</div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {filteredLogs.length > pageSize && (
          <div className="p-4 border-t border-stone-200 bg-stone-50 flex items-center justify-between text-xs text-stone-600">
            <span>
              Showing {(currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, filteredLogs.length)} of {filteredLogs.length} logs
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded border border-stone-200 bg-white hover:bg-stone-100 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-semibold text-stone-800">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded border border-stone-200 bg-white hover:bg-stone-100 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
