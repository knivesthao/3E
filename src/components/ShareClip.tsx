import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';

// Share-a-page clip: records the learner reading over the page art into a
// vertical (9:16) webm — art drawn to canvas, voice from the mic, muxed with
// MediaRecorder. $0, fully on-device, nothing uploaded. Parents can post it
// straight to socials from the finished state.
const WIDTH = 540;
const HEIGHT = 960;
const MAX_SECONDS = 30;

type Phase = 'idle' | 'recording' | 'done';

export function ShareClipPanel({
  imageUrl,
  title,
  pageLabel,
}: {
  imageUrl: string;
  title: string;
  pageLabel: string;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (clipUrl) URL.revokeObjectURL(clipUrl);
    },
    // clipUrl revoked on replace/unmount; fresh takes revoke the old one below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function cleanup() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
  }

  async function start() {
    setError(null);
    if (typeof MediaRecorder === 'undefined' || typeof document === 'undefined') {
      setError('Clip recording is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    try {
      const art = await loadImage(imageUrl);
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      drawCover(ctx, art);
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mixed = new MediaStream([
        ...canvas.captureStream(30).getVideoTracks(),
        ...mic.getAudioTracks(),
      ]);
      streamRef.current = mixed;
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      const rec = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
        if (clipUrl) URL.revokeObjectURL(clipUrl);
        setClipUrl(URL.createObjectURL(blob));
        setPhase('done');
        cleanup();
      };
      recRef.current = rec;
      rec.start(250);
      setSeconds(0);
      setPhase('recording');
      const started = Date.now();
      timerRef.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - started) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) stop();
      }, 500);
    } catch {
      cleanup();
      setError('Could not start the clip — allow the microphone and try again.');
    }
  }

  function stop() {
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
  }

  async function share() {
    if (!clipUrl) return;
    try {
      const blob = await (await fetch(clipUrl)).blob();
      const file = new File([blob], `${title}-${pageLabel}.webm`, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `3E · ${title}` });
        return;
      }
    } catch {
      // Share sheet dismissed or failed: fall through to download.
    }
    const a = document.createElement('a');
    a.href = clipUrl;
    a.download = `${title}-${pageLabel}.webm`;
    a.click();
  }

  if (phase === 'recording') {
    return (
      <div className="flex items-center gap-2" aria-live="polite">
        <Button onClick={stop} variant="primary" size="sm" aria-label="Stop recording the clip">
          <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
          Stop ({seconds}s)
        </Button>
      </div>
    );
  }

  if (phase === 'done' && clipUrl) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={share} variant="primary" size="sm">
          Share clip
        </Button>
        <Button onClick={() => void start()} size="sm">
          New take
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Button onClick={() => void start()} size="sm" aria-label={`Record a video clip of ${pageLabel}`}>
        🎬 Clip
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('art failed to load'));
    img.src = src;
  });
}

// Cover-fit the panel art into the vertical frame, blurred-fill behind so
// narrow art never letterboxes.
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.filter = 'blur(24px) brightness(0.6)';
  ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
  ctx.filter = 'none';
  const scale = Math.max(WIDTH / img.width, HEIGHT / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
}
