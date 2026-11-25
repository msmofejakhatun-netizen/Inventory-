import React from 'react';
import {
  CheckCircle2,
  Clock,
  FileDown,
  PenTool,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { IssueSession, UserRole } from '../../types';
import { Modal } from '../common/Modal';
import { Badge } from '../common/Badge';
import {
  canUserSignManagerSignature,
  canUserSignReceiverSignature,
  formatDateTimeInTimeZone,
  formatQty,
  formatShiftLabel,
} from '../../utils/issueManagement';

interface IssueSessionDetailModalProps {
  session: IssueSession | null;
  currencySymbol: string;
  timezone?: string;
  currentUserUid: string | null;
  currentUserRole: UserRole | null;
  onClose: () => void;
  onRequestSign: (session: IssueSession, type: 'manager' | 'receiver') => void;
  onDownloadSinglePdf: (session: IssueSession) => void;
}

export const IssueSessionDetailModal: React.FC<IssueSessionDetailModalProps> = ({
  session,
  currencySymbol,
  timezone,
  currentUserUid,
  currentUserRole,
  onClose,
  onRequestSign,
  onDownloadSinglePdf,
}) => {
  if (!session) return null;

  const canSignManager = canUserSignManagerSignature(session, currentUserUid, currentUserRole);
  const canSignReceiver = canUserSignReceiverSignature(session, currentUserUid, currentUserRole);

  const mgrSigned = session.managerSignature?.status === 'SIGNED';
  const rcvSigned = session.receiverSignature?.status === 'SIGNED';

  return (
    <Modal
      id="issue-session-detail-modal"
      isOpen={Boolean(session)}
      onClose={onClose}
      title={`Issue #${session.issueNumber}`}
      subtitle={`${session.departmentName} • ${formatShiftLabel(session.shift)}`}
      maxWidth="2xl"
    >
      <div className="space-y-5 text-xs">
        {/* Session Summary Header */}
        <div className="rounded-xl bg-[#0D2149] text-white p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-md bg-[#FF5A1F] text-white font-mono font-extrabold text-xs">
                #{session.issueNumber}
              </span>
              {session.isLegacy && (
                <span className="px-2 py-0.5 rounded bg-white/15 text-slate-200 text-[10px] font-semibold">
                  Legacy Record
                </span>
              )}
            </div>
            <span className="text-[11px] font-mono text-slate-300">
              {formatDateTimeInTimeZone(session.createdAt, timezone || session.timezone)}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-white/15">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300 block">
                Department
              </span>
              <span className="font-bold text-white mt-0.5 block">{session.departmentName}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300 block">
                Shift
              </span>
              <span className="font-bold text-white mt-0.5 block">
                {formatShiftLabel(session.shift)}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300 block">
                Issued By
              </span>
              <span className="font-semibold text-white mt-0.5 block">{session.issuedByName}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300 block">
                Received By
              </span>
              <span className="font-bold text-[#FF7A29] mt-0.5 block">
                {session.receivedByName}
              </span>
            </div>
          </div>
        </div>

        {/* Itemized Table */}
        <div className="rounded-xl border border-stone-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-600 uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">No.</th>
                  <th className="py-2.5 px-3">Item Name</th>
                  <th className="py-2.5 px-3 text-right">Quantity</th>
                  <th className="py-2.5 px-3 text-center">UOM</th>
                  <th className="py-2.5 px-3 text-right">Unit Rate</th>
                  <th className="py-2.5 px-3 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {(session.items || []).map((item, idx) => (
                  <tr key={`${item.itemId}-${idx}`} className="hover:bg-stone-50/60">
                    <td className="py-2.5 px-3 font-mono text-stone-500">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-semibold text-stone-900">{item.itemName}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-stone-900">
                      {formatQty(item.quantity)}
                    </td>
                    <td className="py-2.5 px-3 text-center text-stone-600 font-medium">
                      {item.unit}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-stone-600">
                      {currencySymbol}
                      {Number(item.rate || 0).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-stone-900">
                      {currencySymbol}
                      {Number(item.value || 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-stone-50 border-t border-stone-200 font-bold text-[#0D2149]">
                <tr>
                  <td colSpan={5} className="py-2.5 px-3 text-right uppercase text-[11px]">
                    Session Subtotal ({session.items?.length || 0}{' '}
                    {(session.items?.length || 0) === 1 ? 'Item' : 'Items'})
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-sm">
                    {currencySymbol}
                    {Number(session.totalValue || 0).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Separate Manager & Chef/Staff Signature Verification Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Manager Signature Card */}
          <div className="rounded-xl border border-stone-200 p-3.5 bg-white flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-[#0D2149] uppercase tracking-wider text-[11px]">
                Manager Signature
              </span>
              {mgrSigned ? (
                <Badge variant="success" size="sm">
                  Signed
                </Badge>
              ) : (
                <Badge variant="warning" size="sm">
                  Pending Signature
                </Badge>
              )}
            </div>

            {mgrSigned && session.managerSignature.signatureDataUrl ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-stone-200 bg-white p-2 flex items-center justify-center h-24">
                  <img
                    src={session.managerSignature.signatureDataUrl}
                    alt="Manager Signature"
                    className="max-h-20 object-contain"
                  />
                </div>
                <div className="text-[11px] text-stone-600 space-y-0.5">
                  <p className="font-bold text-stone-900 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{session.managerSignature.signerName}</span>
                  </p>
                  {session.managerSignature.signedAt && (
                    <p className="font-mono text-[10px] text-stone-500">
                      {formatDateTimeInTimeZone(
                        session.managerSignature.signedAt,
                        timezone || session.timezone
                      )}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 h-20 flex flex-col items-center justify-center text-stone-400">
                  <Clock className="w-4 h-4 mb-1" />
                  <span className="text-[11px] font-medium">Pending Signature</span>
                </div>
                {canSignManager ? (
                  <button
                    id="detail-sign-manager-btn"
                    type="button"
                    onClick={() => onRequestSign(session, 'manager')}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0D2149] hover:bg-[#153168] text-white text-xs font-bold transition-colors"
                  >
                    <PenTool className="w-3.5 h-3.5 text-[#FF5A1F]" />
                    <span>Capture Manager Signature</span>
                  </button>
                ) : (
                  <p className="text-[10px] text-stone-400 flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {session.isLegacy
                        ? 'Legacy issue records are read-only.'
                        : session.receiverSignature?.signerUid === currentUserUid
                        ? 'You already signed as Receiver. A separate Manager must approve.'
                        : 'Requires authorized Owner or Manager role.'}
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Chef / Staff Receiving Signature Card */}
          <div className="rounded-xl border border-stone-200 p-3.5 bg-white flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-[#0D2149] uppercase tracking-wider text-[11px]">
                Received By – Chef / Staff
              </span>
              {rcvSigned ? (
                <Badge variant="success" size="sm">
                  Signed
                </Badge>
              ) : (
                <Badge variant="warning" size="sm">
                  Pending Signature
                </Badge>
              )}
            </div>

            {rcvSigned && session.receiverSignature.signatureDataUrl ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-stone-200 bg-white p-2 flex items-center justify-center h-24">
                  <img
                    src={session.receiverSignature.signatureDataUrl}
                    alt="Chef/Staff Receiving Signature"
                    className="max-h-20 object-contain"
                  />
                </div>
                <div className="text-[11px] text-stone-600 space-y-0.5">
                  <p className="font-bold text-stone-900 inline-flex items-center gap-1">
                    <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{session.receiverSignature.signerName}</span>
                  </p>
                  {session.receiverSignature.signedAt && (
                    <p className="font-mono text-[10px] text-stone-500">
                      {formatDateTimeInTimeZone(
                        session.receiverSignature.signedAt,
                        timezone || session.timezone
                      )}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 h-20 flex flex-col items-center justify-center text-stone-400">
                  <Clock className="w-4 h-4 mb-1" />
                  <span className="text-[11px] font-medium">
                    Pending ({session.receivedByName})
                  </span>
                </div>
                {canSignReceiver ? (
                  <button
                    id="detail-sign-receiver-btn"
                    type="button"
                    onClick={() => onRequestSign(session, 'receiver')}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#FF5A1F] hover:bg-[#e24c16] text-white text-xs font-bold transition-colors"
                  >
                    <PenTool className="w-3.5 h-3.5" />
                    <span>Capture Chef / Staff Signature</span>
                  </button>
                ) : (
                  <p className="text-[10px] text-stone-400 flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {session.isLegacy
                        ? 'Legacy issue records are read-only.'
                        : session.managerSignature?.signerUid === currentUserUid
                        ? 'You already signed as Manager. The receiving Chef/Staff must sign separately.'
                        : 'Only the authorized receiving Chef / Department Staff can sign here.'}
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-stone-100 flex flex-wrap items-center justify-between gap-2">
          <button
            id="detail-download-session-pdf-btn"
            type="button"
            onClick={() => onDownloadSinglePdf(session)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#0D2149]/25 text-[#0D2149] hover:bg-[#0D2149]/5 text-xs font-bold transition-colors"
          >
            <FileDown className="w-4 h-4 text-[#FF5A1F]" />
            <span>Download Session PDF</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#0D2149] hover:bg-[#153168] text-white text-xs font-bold"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};
