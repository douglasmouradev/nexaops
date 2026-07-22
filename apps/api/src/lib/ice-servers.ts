/**
 * ICE servers para WebRTC (viewer / agent experimental).
 * Path oficial de mídia no NexaOps = JPEG via Socket.io; Guacamole/Mesh/noVNC para produção.
 * WebRTC nativo (wrtc) é opcional e frágil no MSI Windows.
 */
export function getIceServers(): RTCIceServerLike[] {
  const servers: RTCIceServerLike[] = [];

  const json = process.env.ICE_SERVERS_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json) as RTCIceServerLike[];
      if (Array.isArray(parsed)) servers.push(...parsed);
    } catch {
      /* ignore */
    }
  }

  if (servers.length === 0) {
    servers.push({ urls: 'stun:stun.l.google.com:19302' });
  }

  const turnUrl = process.env.TURN_URL || process.env.VITE_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.TURN_USER || process.env.VITE_TURN_USER,
      credential: process.env.TURN_PASS || process.env.VITE_TURN_PASS,
    });
  }

  return servers;
}

export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}
