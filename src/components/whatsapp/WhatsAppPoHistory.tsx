import React, { useEffect, useState } from 'react';
import {
  MessageSquare,
  CheckCircle,
  CheckCheck,
  AlertCircle,
  Clock,
  RefreshCw,
  Send,
  ExternalLink,
} from 'lucide-react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { WhatsAppMessageRecord, PurchaseOrder } from '../../types';
import { Badge } from '../common/Badge';

interface WhatsAppPoHistoryProps {
  restaurantId: string;
  po: PurchaseOrder;
  onResend: (po: PurchaseOrder) => void;
  isSending?: boolean;
}

export const WhatsAppPoHistory: React.FC<WhatsAppPoHistoryProps> = ({
  restaurantId,
  po,
  onResend,
  isSending = false,
}) => {
  const [messages, setMessages] = useState<WhatsAppMessageRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!restaurantId || !po.id) return;

    const messagesCol = collection(db, 'restaurants', restaurantId, 'whatsappMessages');
    const q = query(
      messagesCol,
      where('purchaseOrderId', '==', po.id),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => d.data() as WhatsAppMessageRecord);
        setMessages(list);
        setLoading(false);
      },
      (err) => {
        console.warn('WhatsApp history listener notice:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId, po.id]);

  if (loading && messages.length === 0) {
    return null;
  }

  if (messages.length === 0 && !po.whatsappMessageId && po.status !== 'PENDING_SEND') {
    return null;
  }

  const latestMessage = messages[0];

  const handleTriggerResend = () => {
    const confirmed = window.confirm('Send this purchase order again to the vendor?');
    if (confirmed) {
      onResend(po);
    }
  };

  return (
    <div className="mt-3 p-3 bg-stone-50 border border-stone-200 rounded-xl space-y-2.5 text-xs">
      <div className="flex items-center justify-between border-b border-stone-200 pb-2">
        <div className="flex items-center gap-1.5 font-bold text-stone-800 uppercase tracking-wider text-[11px]">
          <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
          <span>Official WhatsApp History</span>
        </div>

        {latestMessage && (
          <div className="flex items-center gap-2">
            {latestMessage.status === 'READ' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                <CheckCheck className="w-3.5 h-3.5 text-sky-600" /> Read
              </span>
            )}
            {latestMessage.status === 'DELIVERED' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                <CheckCheck className="w-3.5 h-3.5 text-emerald-600" /> Delivered
              </span>
            )}
            {latestMessage.status === 'SENT' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                <CheckCircle className="w-3.5 h-3.5 text-teal-600" /> Sent to Server
              </span>
            )}
            {latestMessage.status === 'FAILED' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" /> Failed
              </span>
            )}
          </div>
        )}
      </div>

      {latestMessage ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="bg-white p-2 rounded border border-stone-200">
              <span className="text-[10px] text-stone-500 uppercase block">Recipient</span>
              <span className="font-mono font-semibold text-stone-900">
                {latestMessage.vendorPhone}
              </span>
            </div>

            <div className="bg-white p-2 rounded border border-stone-200">
              <span className="text-[10px] text-stone-500 uppercase block">Sent At</span>
              <span className="text-stone-800">
                {latestMessage.sentAt
                  ? new Date(latestMessage.sentAt).toLocaleTimeString('en-IN')
                  : '—'}
              </span>
            </div>

            <div className="bg-white p-2 rounded border border-stone-200">
              <span className="text-[10px] text-stone-500 uppercase block">Delivered At</span>
              <span className="text-stone-800">
                {latestMessage.deliveredAt
                  ? new Date(latestMessage.deliveredAt).toLocaleTimeString('en-IN')
                  : 'Pending webhook'}
              </span>
            </div>

            <div className="bg-white p-2 rounded border border-stone-200">
              <span className="text-[10px] text-stone-500 uppercase block">Read At</span>
              <span className="text-stone-800">
                {latestMessage.readAt
                  ? new Date(latestMessage.readAt).toLocaleTimeString('en-IN')
                  : 'Not yet'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-500 pt-1">
            <span className="font-mono text-[10px] truncate max-w-xs">
              ID: {latestMessage.messageId}
            </span>

            {latestMessage.status === 'FAILED' ? (
              <div className="flex items-center gap-2">
                <span className="text-rose-700 font-medium">
                  Reason: {latestMessage.errorMessage || 'Dispatch error'}
                </span>
                <button
                  type="button"
                  disabled={isSending}
                  onClick={handleTriggerResend}
                  className="flex items-center gap-1 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold shadow-2xs transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${isSending ? 'animate-spin' : ''}`} />
                  Retry WhatsApp
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isSending}
                onClick={handleTriggerResend}
                className="flex items-center gap-1 px-2.5 py-1 bg-stone-800 hover:bg-stone-900 text-white rounded text-xs font-medium transition-colors"
              >
                <Send className={`w-3 h-3 ${isSending ? 'animate-spin' : ''}`} />
                Resend WhatsApp
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between text-[11px] text-stone-500">
          <span>Awaiting WhatsApp transmission record...</span>
          <button
            type="button"
            disabled={isSending}
            onClick={handleTriggerResend}
            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold shadow-2xs transition-colors"
          >
            <Send className="w-3 h-3" /> Send WhatsApp
          </button>
        </div>
      )}
    </div>
  );
};
