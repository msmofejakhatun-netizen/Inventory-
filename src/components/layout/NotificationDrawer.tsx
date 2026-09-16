import React, { useEffect, useState } from 'react';
import {
  X,
  Bell,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  AlertOctagon,
  Trash2,
  Clock,
} from 'lucide-react';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { NotificationItem } from '../../types';
import { Badge } from '../common/Badge';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onUnreadCountChange?: (count: number) => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  isOpen,
  onClose,
  onUnreadCountChange,
}) => {
  const { activeRestaurantId } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeRestaurantId) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    const colRef = collection(db, 'restaurants', activeRestaurantId, 'notifications');
    const q = query(colRef, orderBy('createdAt', 'desc'), limit(30));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => d.data() as NotificationItem);
        setNotifications(list);
        setLoading(false);
        const unread = list.filter((n) => !n.isRead).length;
        if (onUnreadCountChange) onUnreadCountChange(unread);
      },
      (err) => {
        console.error('Error fetching notifications:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [activeRestaurantId, onUnreadCountChange]);

  const markAsRead = async (notifId: string) => {
    if (!activeRestaurantId) return;
    try {
      const docRef = doc(db, 'restaurants', activeRestaurantId, 'notifications', notifId);
      await updateDoc(docRef, { isRead: true });
    } catch (e) {
      console.error('Failed to mark read:', e);
    }
  };

  const markAllAsRead = async () => {
    if (!activeRestaurantId || notifications.length === 0) return;
    try {
      const batch = writeBatch(db);
      notifications
        .filter((n) => !n.isRead)
        .forEach((n) => {
          const docRef = doc(db, 'restaurants', activeRestaurantId, 'notifications', n.id);
          batch.update(docRef, { isRead: true });
        });
      await batch.commit();
    } catch (e) {
      console.error('Failed to mark all read:', e);
    }
  };

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'PRICE_HIKE':
        return <TrendingUp className="w-4 h-4 text-rose-600" />;
      case 'EMERGENCY_ALERT':
        return <AlertOctagon className="w-4 h-4 text-amber-600" />;
      case 'LOW_STOCK':
      case 'EXCESS_STOCK':
        return <AlertTriangle className="w-4 h-4 text-amber-600" />;
      default:
        return <Bell className="w-4 h-4 text-sky-600" />;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-stone-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col border-l border-stone-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-stone-700" />
            <h3 className="font-semibold text-stone-900 text-sm">Store Alerts & Notifications</h3>
            <Badge variant="warning" size="sm">
              {notifications.filter((n) => !n.isRead).length} new
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {notifications.some((n) => !n.isRead) && (
              <button
                id="mark-all-read-btn"
                onClick={markAllAsRead}
                className="text-xs text-amber-600 hover:text-amber-800 font-medium"
              >
                Mark all read
              </button>
            )}
            <button
              id="close-notif-drawer-btn"
              onClick={onClose}
              className="p-1 text-stone-400 hover:text-stone-700 rounded-md"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="text-center py-10 text-stone-400 text-xs">Loading alerts...</div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-12 text-stone-400">
              <CheckCircle className="w-8 h-8 mx-auto mb-2 text-emerald-500 opacity-60" />
              <p className="text-sm font-medium text-stone-700">No active alerts</p>
              <p className="text-xs text-stone-400 mt-1">
                Stock alerts, price hikes, and emergency requisitions will appear here automatically.
              </p>
            </div>
          ) : (
            notifications.map((notif) => (
              <div
                key={notif.id}
                id={`notif-${notif.id}`}
                onClick={() => !notif.isRead && markAsRead(notif.id)}
                className={`p-3 rounded-lg border text-xs transition-colors cursor-pointer ${
                  notif.isRead
                    ? 'bg-stone-50 border-stone-200/70 text-stone-600'
                    : 'bg-amber-50/40 border-amber-200 text-stone-900 shadow-2xs'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 p-1 rounded-md bg-white border border-stone-200 shrink-0">
                    {getIcon(notif.type)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-stone-900">{notif.title}</h4>
                      {!notif.isRead && (
                        <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                      )}
                    </div>
                    <p className="mt-1 text-stone-600 leading-relaxed">{notif.message}</p>
                    <div className="mt-2 flex items-center gap-1 text-[10px] text-stone-400">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span>•</span>
                      <span>{new Date(notif.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
