import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  Eye,
  FileDown,
  PenTool,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Department, Issue, IssueSession, Item, RestaurantUser } from '../types';
import {
  MultiItemIssueSessionResult,
  saveIssueSessionSignature,
} from '../services/restaurantService';
import { exportToCsv } from '../services/exportService';
import { downloadStoreToKitchenIssuePdf } from '../services/issuePdfService';
import { Badge } from '../components/common/Badge';
import { NewIssueSessionModal } from '../components/issues/NewIssueSessionModal';
import { IssueSessionDetailModal } from '../components/issues/IssueSessionDetailModal';
import { SignaturePadModal } from '../components/issues/SignaturePadModal';
import {
  IssueDateFilterPreset,
  canUserSignManagerSignature,
  canUserSignReceiverSignature,
  combineIssueSessionsWithLegacyRecords,
  filterIssueSessionsByDateRange,
  formatDateKeyReadable,
  formatDateTimeInTimeZone,
  formatQty,
  formatShiftLabel,
  getIssueDateRange,
  getLocalDateKey,
  isIssueSessionBackdated,
  resolveSafeTimeZone,
  shiftDateKey,
} from '../utils/issueManagement';

export const IssuesView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile, activeRole, hasRole } = useAuth();

  const [issueSessions, setIssueSessions] = useState<IssueSession[]>([]);
  const [legacyIssues, setLegacyIssues] = useState<Issue[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staffMembers, setStaffMembers] = useState<RestaurantUser[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(true);

  // RBAC: Owner, Manager, Storekeeper can create issue sessions; Department Staff views & signs received sessions
  const canCreateIssueSession = hasRole(['OWNER', 'MANAGER', 'STOREKEEPER']);

  const restaurantTimeZone = resolveSafeTimeZone(activeRestaurant?.timezone);
  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  // Date Filters (Today, Yesterday, Last 7 Days, Custom Date)
  const [datePreset, setDatePreset] = useState<IssueDateFilterPreset>('TODAY');
  const [customStartDate, setCustomStartDate] = useState<string>(() =>
    getLocalDateKey(new Date(), activeRestaurant?.timezone)
  );
  const [customEndDate, setCustomEndDate] = useState<string>(() =>
    getLocalDateKey(new Date(), activeRestaurant?.timezone)
  );

  // Search, Department & Shift Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDeptId, setFilterDeptId] = useState('ALL');
  const [filterShift, setFilterShift] = useState<'ALL' | Issue['shift']>('ALL');

  // Modals & Active Selections
  const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false);
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const [signingTarget, setSigningTarget] = useState<{
    session: IssueSession;
    type: 'manager' | 'receiver';
  } | null>(null);

  // Inline feedback banner
  const [feedbackNotice, setFeedbackNotice] = useState<{
    variant: 'success' | 'error';
    message: string;
  } | null>(null);

  // Sync custom date defaults when switching restaurants/timezones
  useEffect(() => {
    const today = getLocalDateKey(new Date(), activeRestaurant?.timezone);
    setCustomStartDate(today);
    setCustomEndDate(today);
    setViewingSessionId(null);
    setSigningTarget(null);
    setFeedbackNotice(null);
  }, [activeRestaurantId, activeRestaurant?.timezone]);

  // Real-time Firestore listeners (tenant isolated)
  useEffect(() => {
    if (!activeRestaurantId) return;

    setLoadingSessions(true);
    setItemsLoading(true);

    const unsubSessions = onSnapshot(
      query(
        collection(db, 'restaurants', activeRestaurantId, 'issueSessions'),
        orderBy('createdAt', 'desc'),
        limit(300)
      ),
      (snap) => {
        setIssueSessions(snap.docs.map((d) => d.data() as IssueSession));
        setLoadingSessions(false);
      },
      (err) => {
        console.error('Failed to load issue sessions:', err);
        setLoadingSessions(false);
      }
    );

    // Keep reading legacy `issues` docs for 100% backward compatibility with older records
    const unsubLegacyIssues = onSnapshot(
      query(
        collection(db, 'restaurants', activeRestaurantId, 'issues'),
        orderBy('createdAt', 'desc'),
        limit(300)
      ),
      (snap) => {
        setLegacyIssues(snap.docs.map((d) => d.data() as Issue));
      }
    );

    const unsubItems = onSnapshot(
      collection(db, 'restaurants', activeRestaurantId, 'items'),
      (snap) => {
        setItems(snap.docs.map((d) => d.data() as Item));
        setItemsLoading(false);
      },
      () => setItemsLoading(false)
    );

    const unsubDepts = onSnapshot(
      collection(db, 'restaurants', activeRestaurantId, 'departments'),
      (snap) => {
        setDepartments(snap.docs.map((d) => d.data() as Department));
      }
    );

    const unsubUsers = onSnapshot(
      collection(db, 'restaurants', activeRestaurantId, 'users'),
      (snap) => {
        setStaffMembers(snap.docs.map((d) => d.data() as RestaurantUser));
      }
    );

    return () => {
      unsubSessions();
      unsubLegacyIssues();
      unsubItems();
      unsubDepts();
      unsubUsers();
    };
  }, [activeRestaurantId]);

  // Combine modern issueSessions with pre-existing legacy single-item Issue records (without merging distinct sessions)
  const allSessions = useMemo(
    () => combineIssueSessionsWithLegacyRecords(issueSessions, legacyIssues, restaurantTimeZone),
    [issueSessions, legacyIssues, restaurantTimeZone]
  );

  // Active Date Range computed in restaurant's local timezone
  const activeDateRange = useMemo(
    () => getIssueDateRange(datePreset, restaurantTimeZone, customStartDate, customEndDate),
    [datePreset, restaurantTimeZone, customStartDate, customEndDate]
  );

  // Sessions matching selected date range ONLY (used for period stats & combined PDF)
  const dateFilteredSessions = useMemo(
    () => filterIssueSessionsByDateRange(allSessions, activeDateRange, restaurantTimeZone),
    [allSessions, activeDateRange, restaurantTimeZone]
  );

  // Apply department, shift & text search filters on top of Issue Date filter
  const visibleSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return dateFilteredSessions.filter((session) => {
      const matchesDept = filterDeptId === 'ALL' || session.departmentId === filterDeptId;
      if (!matchesDept) return false;
      const matchesShift = filterShift === 'ALL' || session.shift === filterShift;
      if (!matchesShift) return false;
      if (!q) return true;
      const inHeader =
        (session.issueNumber || '').toLowerCase().includes(q) ||
        (session.departmentName || '').toLowerCase().includes(q) ||
        (session.receivedByName || '').toLowerCase().includes(q) ||
        (session.issuedByName || '').toLowerCase().includes(q) ||
        (session.issueDate || '').toLowerCase().includes(q);
      if (inHeader) return true;
      return (session.items || []).some((it) => (it.itemName || '').toLowerCase().includes(q));
    });
  }, [dateFilteredSessions, filterDeptId, filterShift, searchQuery]);

  // Live viewing session reference so signatures update immediately in the detail modal
  const liveViewingSession = useMemo(
    () => (viewingSessionId ? allSessions.find((s) => s.id === viewingSessionId) || null : null),
    [viewingSessionId, allSessions]
  );

  // Period summary totals (reflecting currently displayed date/department selection)
  const periodSummary = useMemo(() => {
    const totalSessions = visibleSessions.length;
    const totalItemsIssued = visibleSessions.reduce(
      (sum, s) => sum + (s.items?.length || s.totalItems || 0),
      0
    );
    const totalValue = Number(
      visibleSessions.reduce((sum, s) => sum + (Number(s.totalValue) || 0), 0).toFixed(2)
    );
    const pendingSignatures = visibleSessions.filter(
      (s) =>
        !s.isLegacy &&
        (s.managerSignature?.status !== 'SIGNED' || s.receiverSignature?.status !== 'SIGNED')
    ).length;
    return { totalSessions, totalItemsIssued, totalValue, pendingSignatures };
  }, [visibleSessions]);

  const showNotice = (variant: 'success' | 'error', message: string) => {
    setFeedbackNotice({ variant, message });
    window.setTimeout(() => {
      setFeedbackNotice((prev) => (prev?.message === message ? null : prev));
    }, 6500);
  };

  const handleSessionCreated = (result: MultiItemIssueSessionResult) => {
    const formattedDate = formatDateKeyReadable(result.issueDate);
    showNotice(
      'success',
      `Issue #${result.issueNumber} confirmed for ${formattedDate}${
        result.isBackdated ? ' (Backdated Entry)' : ''
      }! ${result.totalItems} ${
        result.totalItems === 1 ? 'item' : 'items'
      } deducted atomically (${currencySymbol}${result.totalValue.toFixed(2)}).`
    );

    // If the confirmed Issue Date falls outside the active date filter, automatically focus that Issue Date
    const isInsideCurrentRange =
      result.issueDate >= activeDateRange.startDateKey &&
      result.issueDate <= activeDateRange.endDateKey;
    if (!isInsideCurrentRange) {
      const todayKey = getLocalDateKey(new Date(), restaurantTimeZone);
      const yesterdayKey = shiftDateKey(todayKey, -1);
      if (result.issueDate === todayKey) {
        setDatePreset('TODAY');
      } else if (result.issueDate === yesterdayKey) {
        setDatePreset('YESTERDAY');
      } else {
        setCustomStartDate(result.issueDate);
        setCustomEndDate(result.issueDate);
        setDatePreset('CUSTOM');
      }
    }
  };

  const handleSaveSignature = async (signatureDataUrl: string) => {
    if (!activeRestaurantId || !signingTarget || !user?.uid || !activeRole) {
      throw new Error('Authentication context is missing.');
    }

    await saveIssueSessionSignature(activeRestaurantId, signingTarget.session.id, signingTarget.type, {
      signerUid: user.uid,
      signerName: userProfile?.name || user.displayName || user.email || 'Authorized User',
      signerRole: activeRole,
      signatureDataUrl,
    });

    showNotice(
      'success',
      `${
        signingTarget.type === 'manager' ? 'Manager approval' : 'Chef/Staff receiving'
      } signature saved for Issue #${signingTarget.session.issueNumber}. You can now download the updated PDF.`
    );
  };

  const handleDownloadPeriodPdf = () => {
    if (visibleSessions.length === 0) {
      showNotice('error', 'No confirmed issue sessions exist for the selected date filter to export.');
      return;
    }

    downloadStoreToKitchenIssuePdf({
      restaurantName: activeRestaurant?.name || 'STOQO Restaurant',
      restaurantAddress: activeRestaurant?.address,
      currencySymbol,
      timezone: restaurantTimeZone,
      dateRange: activeDateRange,
      sessions: visibleSessions,
    });
  };

  const handleDownloadSingleSessionPdf = (session: IssueSession) => {
    const singleRange = getIssueDateRange(
      'CUSTOM',
      restaurantTimeZone,
      session.issueDate,
      session.issueDate
    );
    downloadStoreToKitchenIssuePdf({
      restaurantName: activeRestaurant?.name || 'STOQO Restaurant',
      restaurantAddress: activeRestaurant?.address,
      currencySymbol,
      timezone: restaurantTimeZone,
      dateRange: {
        ...singleRange,
        label: `Issue #${session.issueNumber} (${singleRange.label})`,
      },
      sessions: [session],
    });
  };

  const handleExportCsv = () => {
    const headers = [
      'Issue ID',
      'Issue Date',
      'Backdated',
      'Entry Recorded On',
      'Department',
      'Shift',
      'Issued By',
      'Received By',
      'Item Name',
      'Quantity',
      'UOM',
      'Unit Rate',
      'Item Cost',
      'Manager Signature',
      'Chef/Staff Signature',
    ];
    const rows: (string | number)[][] = [];
    for (const s of visibleSessions) {
      const backdated = isIssueSessionBackdated(s, restaurantTimeZone);
      const recordedOn = formatDateTimeInTimeZone(s.createdAt, restaurantTimeZone || s.timezone);
      for (const item of s.items || []) {
        rows.push([
          s.issueNumber,
          s.issueDate,
          backdated ? 'Yes' : 'No',
          recordedOn,
          s.departmentName,
          formatShiftLabel(s.shift),
          s.issuedByName,
          s.receivedByName,
          item.itemName,
          item.quantity,
          item.unit,
          item.rate,
          item.value,
          s.managerSignature?.status === 'SIGNED'
            ? `Signed (${s.managerSignature.signerName || ''})`
            : 'Pending',
          s.receiverSignature?.status === 'SIGNED'
            ? `Signed (${s.receiverSignature.signerName || ''})`
            : 'Pending',
        ]);
      }
    }
    exportToCsv(
      `stoqo_issues_${activeDateRange.startDateKey}_to_${activeDateRange.endDateKey}`,
      headers,
      rows
    );
  };

  return (
    <div className="space-y-5">
      {/* Top Hero Banner */}
      <div className="bg-white rounded-2xl border border-stone-200 p-5 sm:p-6 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-extrabold text-[#0D2149] tracking-tight">
              Store to Kitchen Issue Management
            </h1>
            <span className="px-2.5 py-0.5 rounded-md bg-[#FF5A1F]/10 text-[#FF5A1F] text-[11px] font-bold">
              Session Tracking &amp; Signatures
            </span>
          </div>
          <p className="text-xs text-stone-500 leading-relaxed">
            Issue multiple items atomically per kitchen session, track separate Issue IDs, capture Manager &amp; Chef/Staff signatures, and export combined A4 PDF reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreateIssueSession && (
            <button
              id="issue-stock-btn"
              type="button"
              onClick={() => setIsNewSessionModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#FF5A1F] hover:bg-[#e24c16] text-white text-xs font-bold shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Issue Stock to Kitchen</span>
            </button>
          )}

          <button
            id="download-combined-issue-pdf-btn"
            type="button"
            onClick={handleDownloadPeriodPdf}
            disabled={visibleSessions.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#0D2149] hover:bg-[#153168] text-white text-xs font-bold shadow-xs disabled:opacity-45 transition-colors"
          >
            <FileDown className="w-4 h-4 text-[#FF5A1F]" />
            <span>Download PDF</span>
          </button>

          <button
            id="export-issue-csv-btn"
            type="button"
            onClick={handleExportCsv}
            disabled={visibleSessions.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-stone-200 hover:bg-stone-50 text-stone-700 text-xs font-semibold disabled:opacity-45"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Inline Feedback Notice */}
      {feedbackNotice && (
        <div
          id="issue-feedback-notice"
          className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 text-xs font-medium ${
            feedbackNotice.variant === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-start gap-2">
            {feedbackNotice.variant === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <span>{feedbackNotice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackNotice(null)}
            className="text-stone-400 hover:text-stone-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Date Filter Bar (Today, Yesterday, Last 7 Days, Custom Date) */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#0D2149] uppercase tracking-wider mr-1">
              <Calendar className="w-3.5 h-3.5 text-[#FF5A1F]" />
              <span>Date Filter:</span>
            </span>

            {(
              [
                { id: 'TODAY', label: 'Today' },
                { id: 'YESTERDAY', label: 'Yesterday' },
                { id: 'LAST_7_DAYS', label: 'Last 7 Days' },
                { id: 'CUSTOM', label: 'Custom Date' },
              ] as { id: IssueDateFilterPreset; label: string }[]
            ).map((btn) => {
              const active = datePreset === btn.id;
              return (
                <button
                  key={btn.id}
                  id={`issue-date-filter-${btn.id.toLowerCase()}`}
                  type="button"
                  onClick={() => setDatePreset(btn.id)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                    active
                      ? 'bg-[#0D2149] text-white border-[#0D2149] shadow-2xs'
                      : 'bg-white text-stone-700 border-stone-200 hover:border-[#0D2149]/40 hover:bg-stone-50'
                  }`}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>

          <span className="text-[11px] font-medium text-stone-500">
            Showing: <span className="font-bold text-[#0D2149]">{activeDateRange.label}</span>{' '}
            <span className="text-stone-400">({restaurantTimeZone})</span>
          </span>
        </div>

        {/* Custom Date Range Pickers */}
        {datePreset === 'CUSTOM' && (
          <div className="pt-2 border-t border-stone-100 flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="issue-custom-start-date"
                className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1"
              >
                From Date
              </label>
              <input
                id="issue-custom-start-date"
                type="date"
                value={customStartDate}
                onChange={(e) => {
                  setCustomStartDate(e.target.value);
                  if (e.target.value > customEndDate) {
                    setCustomEndDate(e.target.value);
                  }
                }}
                className="px-3 py-1.5 text-xs font-mono border border-stone-300 rounded-lg bg-white text-stone-800 focus:outline-none focus:border-[#0D2149]"
              />
            </div>
            <div>
              <label
                htmlFor="issue-custom-end-date"
                className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1"
              >
                To Date
              </label>
              <input
                id="issue-custom-end-date"
                type="date"
                value={customEndDate}
                min={customStartDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-3 py-1.5 text-xs font-mono border border-stone-300 rounded-lg bg-white text-stone-800 focus:outline-none focus:border-[#0D2149]"
              />
            </div>
          </div>
        )}

        {/* Search, Department & Shift Filter */}
        <div className="pt-2 border-t border-stone-100 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              id="issue-history-search-input"
              type="text"
              placeholder="Search by Issue ID (#ISS-001), item name, chef/staff, or storekeeper..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-stone-200 rounded-lg bg-stone-50/50 focus:bg-white focus:outline-none focus:border-[#0D2149]"
            />
          </div>

          <select
            id="issue-history-dept-filter"
            value={filterDeptId}
            onChange={(e) => setFilterDeptId(e.target.value)}
            className="px-3 py-2 text-xs border border-stone-200 rounded-lg bg-white text-stone-700 font-medium focus:outline-none focus:border-[#0D2149]"
          >
            <option value="ALL">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <select
            id="issue-history-shift-filter"
            value={filterShift}
            onChange={(e) => setFilterShift(e.target.value as 'ALL' | Issue['shift'])}
            className="px-3 py-2 text-xs border border-stone-200 rounded-lg bg-white text-stone-700 font-medium focus:outline-none focus:border-[#0D2149]"
          >
            <option value="ALL">All Shifts</option>
            <option value="MORNING">Morning Shift</option>
            <option value="EVENING">Evening Shift</option>
            <option value="NIGHT">Night Shift</option>
            <option value="GENERAL">General Store</option>
          </select>
        </div>
      </div>

      {/* Period Summary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-stone-200 p-4 border-l-4 border-l-[#0D2149]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">
            Issue Sessions
          </span>
          <p id="summary-total-sessions" className="text-xl font-black text-[#0D2149] mt-1 font-mono">
            {periodSummary.totalSessions}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-4 border-l-4 border-l-[#FF5A1F]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">
            Total Items Issued
          </span>
          <p id="summary-total-items" className="text-xl font-black text-stone-900 mt-1 font-mono">
            {periodSummary.totalItemsIssued}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-4 border-l-4 border-l-emerald-600">
          <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">
            Total Issue Value
          </span>
          <p id="summary-total-value" className="text-xl font-black text-stone-900 mt-1 font-mono">
            {currencySymbol}
            {periodSummary.totalValue.toFixed(2)}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-4 border-l-4 border-l-amber-500">
          <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">
            Awaiting Signatures
          </span>
          <p id="summary-pending-signatures" className="text-xl font-black text-amber-700 mt-1 font-mono">
            {periodSummary.pendingSignatures}
          </p>
        </div>
      </div>

      {/* Issue Sessions History — Desktop Table & Mobile Cards */}
      {loadingSessions ? (
        <div className="bg-white rounded-2xl border border-stone-200 p-12 text-center text-xs text-stone-400">
          Loading Store to Kitchen issue history...
        </div>
      ) : visibleSessions.length === 0 ? (
        <div
          id="issue-history-empty-state"
          className="bg-white rounded-2xl border border-stone-200 p-12 text-center space-y-2.5"
        >
          <div className="w-12 h-12 rounded-2xl bg-[#0D2149]/5 text-[#0D2149] mx-auto flex items-center justify-center">
            <ClipboardList className="w-6 h-6 text-[#FF5A1F]" />
          </div>
          <h3 className="text-sm font-bold text-[#0D2149]">
            No issue sessions found for {activeDateRange.label}
          </h3>
          <p className="text-xs text-stone-500 max-w-md mx-auto">
            Confirmed Store to Kitchen issue sessions appear here as separate records with unique Issue IDs. Try selecting another date filter or create a new issue session.
          </p>
          {canCreateIssueSession && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setIsNewSessionModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FF5A1F] hover:bg-[#e24c16] text-white text-xs font-bold"
              >
                <Plus className="w-4 h-4" />
                <span>Issue Stock to Kitchen</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden lg:block bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#0D2149] text-white text-[11px] font-bold uppercase tracking-wider">
                  <tr>
                    <th className="py-3.5 px-4">Issue ID</th>
                    <th className="py-3.5 px-4">Issue Date</th>
                    <th className="py-3.5 px-4">Department &amp; Shift</th>
                    <th className="py-3.5 px-4 text-center">Items</th>
                    <th className="py-3.5 px-4">Issued By / Received By</th>
                    <th className="py-3.5 px-4 text-right">Total Value</th>
                    <th className="py-3.5 px-4">Manager Sig.</th>
                    <th className="py-3.5 px-4">Chef/Staff Sig.</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {visibleSessions.map((session) => {
                    const mgrSigned = session.managerSignature?.status === 'SIGNED';
                    const rcvSigned = session.receiverSignature?.status === 'SIGNED';
                    const canSignMgr = canUserSignManagerSignature(session, user?.uid, activeRole);
                    const canSignRcv = canUserSignReceiverSignature(session, user?.uid, activeRole);
                    const backdated = isIssueSessionBackdated(session, restaurantTimeZone);
                    const previewItems = (session.items || [])
                      .slice(0, 2)
                      .map((it) => `${it.itemName} (${formatQty(it.quantity)} ${it.unit})`)
                      .join(', ');
                    const moreCount = Math.max(0, (session.items?.length || 0) - 2);

                    return (
                      <tr
                        key={session.id}
                        id={`issue-session-row-${session.id}`}
                        className="hover:bg-stone-50/70 transition-colors"
                      >
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="inline-block px-2 py-0.5 rounded-md bg-[#0D2149]/8 text-[#0D2149] font-mono font-extrabold text-xs">
                            #{session.issueNumber}
                          </span>
                          {session.isLegacy && (
                            <span className="block text-[10px] text-stone-400 mt-0.5">Legacy</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-xs text-[#0D2149]">
                              {formatDateKeyReadable(session.issueDate)}
                            </span>
                            {backdated && (
                              <span className="px-1.5 py-0.5 rounded bg-[#FF5A1F]/12 text-[#FF5A1F] text-[10px] font-bold">
                                Backdated
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[10px] text-stone-400 mt-0.5">
                            Recorded:{' '}
                            {formatDateTimeInTimeZone(
                              session.createdAt,
                              restaurantTimeZone || session.timezone
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-bold text-stone-900">{session.departmentName}</div>
                          <div className="text-[11px] text-stone-500 mt-0.5">
                            {formatShiftLabel(session.shift)}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full bg-stone-100 text-[#0D2149] font-mono font-bold text-xs">
                            {session.items?.length || session.totalItems || 0}
                          </span>
                          {previewItems && (
                            <p
                              className="text-[10px] text-stone-400 max-w-[180px] truncate mt-1 mx-auto"
                              title={previewItems}
                            >
                              {previewItems}
                              {moreCount > 0 ? ` +${moreCount} more` : ''}
                            </p>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="text-[11px] text-stone-500">
                            Out: <span className="font-semibold text-stone-800">{session.issuedByName}</span>
                          </div>
                          <div className="text-[11px] text-stone-500 mt-0.5">
                            In:{' '}
                            <span className="font-bold text-[#0D2149]">{session.receivedByName}</span>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono font-extrabold text-stone-900 whitespace-nowrap">
                          {currencySymbol}
                          {Number(session.totalValue || 0).toFixed(2)}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {mgrSigned ? (
                            <Badge variant="success" size="sm">
                              Signed
                            </Badge>
                          ) : canSignMgr ? (
                            <button
                              type="button"
                              onClick={() => setSigningTarget({ session, type: 'manager' })}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#0D2149]/10 hover:bg-[#0D2149] text-[#0D2149] hover:text-white text-[11px] font-bold transition-colors"
                            >
                              <PenTool className="w-3 h-3" />
                              <span>Sign</span>
                            </button>
                          ) : (
                            <Badge variant="warning" size="sm">
                              Pending
                            </Badge>
                          )}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {rcvSigned ? (
                            <Badge variant="success" size="sm">
                              Signed
                            </Badge>
                          ) : canSignRcv ? (
                            <button
                              type="button"
                              onClick={() => setSigningTarget({ session, type: 'receiver' })}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#FF5A1F]/10 hover:bg-[#FF5A1F] text-[#FF5A1F] hover:text-white text-[11px] font-bold transition-colors"
                            >
                              <PenTool className="w-3 h-3" />
                              <span>Sign</span>
                            </button>
                          ) : (
                            <Badge variant="warning" size="sm">
                              Pending
                            </Badge>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <button
                            id={`view-issue-session-btn-${session.id}`}
                            type="button"
                            onClick={() => setViewingSessionId(session.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-stone-200 hover:border-[#0D2149] hover:bg-[#0D2149]/5 text-[#0D2149] text-[11px] font-bold transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View Details</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile & Tablet Separate Session Cards */}
          <div className="lg:hidden space-y-3">
            {visibleSessions.map((session) => {
              const mgrSigned = session.managerSignature?.status === 'SIGNED';
              const rcvSigned = session.receiverSignature?.status === 'SIGNED';
              const canSignMgr = canUserSignManagerSignature(session, user?.uid, activeRole);
              const canSignRcv = canUserSignReceiverSignature(session, user?.uid, activeRole);
              const backdated = isIssueSessionBackdated(session, restaurantTimeZone);

              return (
                <div
                  key={session.id}
                  id={`mobile-issue-session-card-${session.id}`}
                  className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3 shadow-2xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-0.5 rounded-md bg-[#0D2149] text-white font-mono font-extrabold text-xs">
                          #{session.issueNumber}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 text-[11px] font-bold">
                          {session.items?.length || session.totalItems || 0}{' '}
                          {(session.items?.length || 0) === 1 ? 'Item' : 'Items'}
                        </span>
                        {backdated && (
                          <span className="px-1.5 py-0.5 rounded bg-[#FF5A1F]/12 text-[#FF5A1F] text-[10px] font-bold">
                            Backdated
                          </span>
                        )}
                        {session.isLegacy && (
                          <span className="px-1.5 py-0.5 rounded bg-stone-200 text-stone-600 text-[10px] font-semibold">
                            Legacy
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-mono font-bold text-[#0D2149] mt-1 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-[#FF5A1F]" />
                        <span>Issue Date: {formatDateKeyReadable(session.issueDate)}</span>
                      </p>
                      <p className="text-[10px] font-mono text-stone-400 mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>
                          Recorded:{' '}
                          {formatDateTimeInTimeZone(
                            session.createdAt,
                            restaurantTimeZone || session.timezone
                          )}
                        </span>
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] uppercase text-stone-400 font-bold block">
                        Total Value
                      </span>
                      <span className="text-sm font-mono font-black text-[#0D2149]">
                        {currencySymbol}
                        {Number(session.totalValue || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-stone-50 border border-stone-100 text-xs">
                    <div>
                      <span className="text-[10px] uppercase text-stone-400 font-bold block">
                        Department &amp; Shift
                      </span>
                      <p className="font-bold text-stone-900">{session.departmentName}</p>
                      <p className="text-[11px] text-stone-500">{formatShiftLabel(session.shift)}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-stone-400 font-bold block">
                        Accountability
                      </span>
                      <p className="text-[11px] text-stone-600">
                        Out: <span className="font-semibold text-stone-800">{session.issuedByName}</span>
                      </p>
                      <p className="text-[11px] text-stone-600">
                        In: <span className="font-bold text-[#0D2149]">{session.receivedByName}</span>
                      </p>
                    </div>
                  </div>

                  {/* Compact Item List Preview */}
                  <div className="text-[11px] text-stone-600 space-y-0.5">
                    {(session.items || []).slice(0, 3).map((item, idx) => (
                      <div key={`${item.itemId}-${idx}`} className="flex justify-between gap-2">
                        <span className="truncate font-medium text-stone-800">
                          • {item.itemName}
                        </span>
                        <span className="font-mono font-bold text-stone-700 shrink-0">
                          {formatQty(item.quantity)} {item.unit}
                        </span>
                      </div>
                    ))}
                    {(session.items?.length || 0) > 3 && (
                      <p className="text-[10px] text-[#FF5A1F] font-semibold">
                        +{(session.items?.length || 0) - 3} more items — tap View Details
                      </p>
                    )}
                  </div>

                  {/* Signature Status Strip */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-stone-100 text-[11px]">
                    <div className="flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg bg-stone-50 border border-stone-200/70">
                      <span className="text-stone-500 font-semibold">Manager:</span>
                      <Badge variant={mgrSigned ? 'success' : 'warning'} size="sm">
                        {mgrSigned ? 'Signed' : 'Pending'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg bg-stone-50 border border-stone-200/70">
                      <span className="text-stone-500 font-semibold">Chef/Staff:</span>
                      <Badge variant={rcvSigned ? 'success' : 'warning'} size="sm">
                        {rcvSigned ? 'Signed' : 'Pending'}
                      </Badge>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    {canSignMgr && (
                      <button
                        type="button"
                        onClick={() => setSigningTarget({ session, type: 'manager' })}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#0D2149] text-white text-xs font-bold"
                      >
                        <PenTool className="w-3.5 h-3.5 text-[#FF5A1F]" />
                        <span>Sign Manager</span>
                      </button>
                    )}
                    {canSignRcv && (
                      <button
                        type="button"
                        onClick={() => setSigningTarget({ session, type: 'receiver' })}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#FF5A1F] text-white text-xs font-bold"
                      >
                        <PenTool className="w-3.5 h-3.5" />
                        <span>Sign Received</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setViewingSessionId(session.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-stone-200 text-[#0D2149] hover:bg-stone-50 text-xs font-bold"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View Details</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Multi-Item New Issue Session Modal */}
      <NewIssueSessionModal
        isOpen={isNewSessionModalOpen}
        restaurantId={activeRestaurantId}
        timezone={restaurantTimeZone}
        currencySymbol={currencySymbol}
        items={items}
        itemsLoading={itemsLoading}
        departments={departments}
        staffMembers={staffMembers}
        actorUid={user?.uid || ''}
        actorName={userProfile?.name || user?.displayName || user?.email || 'Storekeeper'}
        actorRole={activeRole}
        onClose={() => setIsNewSessionModalOpen(false)}
        onSuccess={handleSessionCreated}
      />

      {/* Issue Session Details & Signatures Modal */}
      <IssueSessionDetailModal
        session={liveViewingSession}
        currencySymbol={currencySymbol}
        timezone={restaurantTimeZone}
        currentUserUid={user?.uid || null}
        currentUserRole={activeRole}
        onClose={() => setViewingSessionId(null)}
        onRequestSign={(session, type) => setSigningTarget({ session, type })}
        onDownloadSinglePdf={handleDownloadSingleSessionPdf}
      />

      {/* Digital Signature Pad Modal (Manager OR Chef/Staff) */}
      <SignaturePadModal
        isOpen={Boolean(signingTarget)}
        title={
          signingTarget?.type === 'manager'
            ? 'Capture Manager Approval Signature'
            : 'Capture Chef / Staff Receiving Signature'
        }
        subtitle={
          signingTarget?.type === 'manager'
            ? 'Authorized Manager / Owner approval for this issue session'
            : 'Confirm physical receipt of all listed kitchen items'
        }
        signerName={userProfile?.name || user?.displayName || user?.email || 'Authorized User'}
        signerRoleLabel={(activeRole || 'STAFF').replace('_', ' ')}
        sessionSummary={
          signingTarget
            ? `Issue #${signingTarget.session.issueNumber} • ${signingTarget.session.departmentName} • ${
                signingTarget.session.items?.length || 0
              } items (${currencySymbol}${Number(signingTarget.session.totalValue || 0).toFixed(2)})`
            : ''
        }
        onClose={() => setSigningTarget(null)}
        onSave={handleSaveSignature}
      />
    </div>
  );
};
