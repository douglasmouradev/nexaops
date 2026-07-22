/**
 * Sessão WebRTC experimental no agent.
 * Requer `npm i wrtc` (binário nativo — frequentemente falha no Windows MSI).
 * Sem wrtc: mantém JPEG via screen-share (path oficial).
 */
let wrtc = null;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies, global-require
  wrtc = require('wrtc');
} catch {
  wrtc = null;
}

/**
 * @returns {Promise<boolean>} true se answer SDP real foi enviado
 */
async function handleWebRtcOffer(socket, sessionId, offerSdp, iceServers) {
  if (!wrtc || !offerSdp) {
    socket.emit('remote:signal', {
      sessionId,
      data: {
        type: 'answer',
        sdp: null,
        note: 'use-socket-frames',
        reason: wrtc ? 'offer-invalid' : 'wrtc-unavailable',
      },
    });
    return false;
  }

  const { RTCPeerConnection, nonstandard } = wrtc;
  const pc = new RTCPeerConnection({ iceServers: iceServers || [{ urls: 'stun:stun.l.google.com:19302' }] });

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      socket.emit('remote:signal', {
        sessionId,
        data: { type: 'ice', candidate: ev.candidate },
      });
    }
  };

  // Sem capturador de desktop nativo estável: envia vídeo preto 1fps como prova de peer
  // (produção deve usar Guacamole/Mesh ou frames JPEG).
  try {
    if (nonstandard?.RTCVideoSource) {
      const source = new nonstandard.RTCVideoSource();
      const track = source.createTrack();
      pc.addTrack(track);
      const width = 640;
      const height = 360;
      const i420 = Buffer.alloc(width * height * 1.5);
      const timer = setInterval(() => {
        try {
          source.onFrame({ width, height, data: i420 });
        } catch {
          clearInterval(timer);
        }
      }, 1000);
      pc._nexaopsTimer = timer;
    }
  } catch {
    /* ignore */
  }

  await pc.setRemoteDescription(offerSdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('remote:signal', {
    sessionId,
    data: { type: 'answer', sdp: pc.localDescription },
  });
  return true;
}

function isWrtcAvailable() {
  return Boolean(wrtc);
}

module.exports = { handleWebRtcOffer, isWrtcAvailable };
