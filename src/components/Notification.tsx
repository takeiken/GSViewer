import { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

export type NotificationType = 'success' | 'error' | 'info';

export type NotificationItem = {
  id: string;
  message: string;
  type: NotificationType;
};

type NotificationProps = {
  notifications: NotificationItem[];
  removeNotification: (id: string) => void;
};

export default function NotificationContainer({ notifications, removeNotification }: NotificationProps) {
  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none">
      {notifications.map((notification) => (
        <NotificationToast 
          key={notification.id} 
          notification={notification} 
          onClose={() => removeNotification(notification.id)} 
        />
      ))}
    </div>
  );
}

function NotificationToast({ notification, onClose }: { notification: NotificationItem; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const icons = {
    success: <CheckCircle size={18} className="text-green-400" />,
    error: <AlertCircle size={18} className="text-red-400" />,
    info: <Info size={18} className="text-blue-400" />,
  };

  const bgColors = {
    success: 'bg-neutral-900/90 border-green-500/30',
    error: 'bg-neutral-900/90 border-red-500/30',
    info: 'bg-neutral-900/90 border-blue-500/30',
  };

  return (
    <div className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-5 ${bgColors[notification.type]}`}>
      {icons[notification.type]}
      <span className="text-sm text-neutral-200 font-medium">{notification.message}</span>
      <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 transition-colors ml-2">
        <X size={14} />
      </button>
    </div>
  );
}
