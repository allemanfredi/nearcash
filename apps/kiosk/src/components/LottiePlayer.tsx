import { useEffect, useRef } from 'react';
// The light player: SVG only and no expressions, so it never needs eval(),
// which the page's Content-Security-Policy forbids.
import lottie from 'lottie-web/build/player/lottie_light';

/**
 * Plays a Lottie animation once, drawn as SVG. With "Reduce Motion" turned
 * on (iOS accessibility setting) it shows the last frame straight away.
 * `onComplete` runs when the animation has finished (or was skipped).
 */
export function LottiePlayer({
  animation,
  label,
  onComplete,
}: {
  /** The animation document (Lottie JSON as an object). */
  animation: object;
  /** What the animation says, for screen readers. */
  label: string;
  onComplete?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // The latest callback, without restarting the animation when it changes.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const container = box.current;
    if (!container) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const player = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: !reduceMotion,
      animationData: animation,
    });
    const complete = () => onCompleteRef.current?.();
    let skipTimer: number | undefined;
    if (reduceMotion) {
      player.goToAndStop(player.totalFrames - 1, true);
      skipTimer = window.setTimeout(complete, 0);
    } else {
      player.addEventListener('complete', complete);
    }
    return () => {
      window.clearTimeout(skipTimer);
      player.destroy();
    };
  }, [animation]);

  return <div ref={box} className="lottie" role="img" aria-label={label} />;
}
