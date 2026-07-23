import { useEffect, useRef, useState, useCallback } from 'react';
import { useSocket } from '@/hooks/use-socket';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Props {
  sessionId: string;
  connectionUrl?: string | null;
  canEmbedUrl?: boolean;
}

/**
 * Viewer remoto: frames JPEG via Socket.io + input mouse/teclado + signaling WebRTC.
 * Path oficial de mídia = stream JPEG (agent). WebRTC fica para agents com wrtc.
 */
const WEBRTC_ENABLED = import.meta.env.VITE_ENABLE_WEBRTC === 'true';

export function RemoteViewer({ sessionId, connectionUrl, canEmbedUrl }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<'stream' | 'iframe' | 'webrtc'>('stream');
  const [status, setStatus] = useState('Conectando…');
  const [frames, setFrames] = useState(0);
  const [control, setControl] = useState(true);
  const [fps, setFps] = useState(0);
  const frameTimes = useRef<number[]>([]);

  useEffect(() => {
    if (canEmbedUrl && connectionUrl) {
      setMode('iframe');
      setStatus('Viewer externo (Guacamole/Mesh/noVNC)');
    } else {
      setMode('stream');
      setStatus('Aguardando captura do agent…');
    }
  }, [canEmbedUrl, connectionUrl]);

  const { socket, connected } = useSocket({
    enabled: true,
  });

  useEffect(() => {
    if (!socket || !connected) return;

    socket.emit('remote:join', sessionId);
    setStatus('Sala remota ativa — aguardando frames do agent…');

    const onFrame = (payload: { sessionId?: string; mime?: string; data?: string }) => {
      if (payload.sessionId !== sessionId || !payload.data) return;
      if (imgRef.current) {
        imgRef.current.src = `data:${payload.mime || 'image/jpeg'};base64,${payload.data}`;
        setFrames((n) => n + 1);
        const now = Date.now();
        frameTimes.current.push(now);
        frameTimes.current = frameTimes.current.filter((t) => now - t < 1000);
        setFps(frameTimes.current.length);
        setStatus('Stream ativo (captura do agent)');
        setMode('stream');
      }
    };

    const onSignal = async (payload: {
      from?: string;
      sessionId?: string;
      data?: { type?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; note?: string };
    }) => {
      if (payload.sessionId !== sessionId) return;
      const data = payload.data;
      if (!data) return;

      if (data.type === 'answer') {
        if (data.sdp && pcRef.current) {
          await pcRef.current.setRemoteDescription(data.sdp);
          setStatus('WebRTC conectado');
          setMode('webrtc');
        } else if (data.note === 'use-socket-frames') {
          setStatus('Agent usa stream JPEG (controle pelo canvas)');
          setMode('stream');
        }
      }
      if (data.type === 'ice' && data.candidate && pcRef.current) {
        try {
          await pcRef.current.addIceCandidate(data.candidate);
        } catch {
          /* ignore */
        }
      }
      if (data.type === 'viewer-joined') {
        setStatus('Agent notificado — stream/WebRTC');
      }
    };

    socket.on('remote:frame', onFrame);
    socket.on('remote:signal', onSignal);

    return () => {
      socket.off('remote:frame', onFrame);
      socket.off('remote:signal', onSignal);
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [socket, connected, sessionId]);

  const normCoords = useCallback((clientX: number, clientY: number) => {
    const el = surfaceRef.current;
    if (!el) return { x: 0.5, y: 0.5 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    };
  }, []);

  const lastMove = useRef(0);
  const sendInput = useCallback(
    (event: Record<string, unknown>) => {
      if (!socket || !control) return;
      if (event.type === 'mousemove') {
        const now = Date.now();
        if (now - lastMove.current < 80) return;
        lastMove.current = now;
      }
      socket.emit('remote:input', { sessionId, ...event });
    },
    [socket, sessionId, control]
  );

  const startWebRtc = async () => {
    if (!WEBRTC_ENABLED || !socket) return;
    setStatus('Iniciando WebRTC (offer)…');
    let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    try {
      const ice = await api.get<{
        success: boolean;
        data: { iceServers: RTCIceServer[]; note?: string };
      }>('/api/remote-sessions/ice-servers');
      if (ice.data?.iceServers?.length) iceServers = ice.data.iceServers;
      if (ice.data?.note) setStatus(ice.data.note);
    } catch {
      /* keep default STUN */
    }

    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;

    pc.ontrack = (ev) => {
      if (videoRef.current && ev.streams[0]) {
        videoRef.current.srcObject = ev.streams[0];
        setMode('webrtc');
        setStatus('WebRTC: mídia recebida');
      }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        socket.emit('remote:signal', {
          sessionId,
          data: { type: 'ice', candidate: ev.candidate.toJSON() },
        });
      }
    };

    pc.addTransceiver('video', { direction: 'recvonly' });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('remote:signal', {
      sessionId,
      data: { type: 'offer', sdp: offer, iceServers },
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={connected ? 'success' : 'secondary'}>
          {connected ? 'Socket OK' : 'Socket off'}
        </Badge>
        <span className="text-muted-foreground">{status}</span>
        {frames > 0 && (
          <span className="text-muted-foreground">
            {frames} frames · ~{fps} fps
          </span>
        )}
        <Button size="sm" variant={control ? 'default' : 'outline'} onClick={() => setControl((v) => !v)}>
          {control ? 'Controle ON' : 'Controle OFF'}
        </Button>
        {WEBRTC_ENABLED && (
          <Button size="sm" variant="outline" onClick={startWebRtc}>
            WebRTC offer
          </Button>
        )}
        {canEmbedUrl && connectionUrl && (
          <Button size="sm" variant="ghost" onClick={() => setMode('iframe')}>
            Iframe URL
          </Button>
        )}
      </div>

      {mode === 'iframe' && canEmbedUrl && connectionUrl ? (
        <iframe
          title="remote-viewer"
          src={connectionUrl}
          className="min-h-0 flex-1 w-full rounded-md border bg-background"
          allow="clipboard-read; clipboard-write; display-capture"
        />
      ) : (
        <div
          ref={surfaceRef}
          tabIndex={0}
          className="relative min-h-0 flex-1 cursor-crosshair overflow-hidden rounded-md border bg-black outline-none"
          onMouseMove={(e) => {
            if (!control || mode === 'iframe') return;
            const { x, y } = normCoords(e.clientX, e.clientY);
            sendInput({ type: 'mousemove', x, y });
          }}
          onClick={(e) => {
            if (!control) return;
            const { x, y } = normCoords(e.clientX, e.clientY);
            sendInput({ type: 'click', x, y, button: e.button });
            surfaceRef.current?.focus();
          }}
          onContextMenu={(e) => {
            if (!control) return;
            e.preventDefault();
            const { x, y } = normCoords(e.clientX, e.clientY);
            sendInput({ type: 'click', x, y, button: 2 });
          }}
          onWheel={(e) => {
            if (!control) return;
            sendInput({ type: 'wheel', deltaY: e.deltaY });
          }}
          onKeyDown={(e) => {
            if (!control) return;
            e.preventDefault();
            sendInput({ type: 'keydown', key: e.key });
          }}
        >
          <img
            ref={imgRef}
            alt="remote stream"
            className={`pointer-events-none absolute inset-0 h-full w-full object-contain ${mode === 'webrtc' ? 'hidden' : ''}`}
            draggable={false}
          />
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className={`pointer-events-none absolute inset-0 h-full w-full object-contain ${mode === 'webrtc' ? '' : 'hidden'}`}
          />
          {frames === 0 && mode !== 'webrtc' && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white/70">
              {connected
                ? 'Aguardando captura do agent… Confirme MSI 0.3.7+, usuario logado no Windows e Socket OK.'
                : 'Socket desconectado — sem video ate reconectar.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
