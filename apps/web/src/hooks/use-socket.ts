import { useEffect, useRef, useCallback, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '@/lib/api';

const SOCKET_URL = import.meta.env.VITE_API_URL || window.location.origin;

export interface DeviceStatusEvent {
  deviceId: string;
  status: string;
}

export interface UseSocketOptions {
  onDeviceStatus?: (data: DeviceStatusEvent) => void;
  onNewAlert?: (alert: Record<string, unknown>) => void;
  enabled?: boolean;
}

export function useSocket(options: UseSocketOptions = {}) {
  const { enabled = true } = options;
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const onDeviceStatusRef = useRef(options.onDeviceStatus);
  const onNewAlertRef = useRef(options.onNewAlert);

  onDeviceStatusRef.current = options.onDeviceStatus;
  onNewAlertRef.current = options.onNewAlert;

  useEffect(() => {
    if (!enabled) return;

    const token = api.getAccessToken();
    if (!token) return;

    const s = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = s;
    setSocket(s);

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    s.on('device:status', (data: DeviceStatusEvent) => {
      onDeviceStatusRef.current?.(data);
    });

    s.on('alert:new', (alert: Record<string, unknown>) => {
      onNewAlertRef.current?.(alert);
    });

    return () => {
      s.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [enabled]);

  const subscribeDevice = useCallback((deviceId: string) => {
    socketRef.current?.emit('subscribe:device', deviceId);
  }, []);

  return { connected, subscribeDevice, socket };
}
