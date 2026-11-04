/**
 * Guilloché patterns, the fine looping lines printed on real banknotes,
 * generated as SVG path data. Pure functions, computed once per render.
 */

/** Greatest common divisor, used to know when a rosette closes on itself. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Formats a number for path data: 1 decimal is plenty at banknote scale. */
const n = (value: number) => value.toFixed(1);

/**
 * A hypotrochoid (the curve of a Spirograph): a point at distance `d` from
 * the centre of a circle of radius `r` rolling inside a circle of radius `R`.
 * With integer radii the curve closes after r / gcd(R, r) turns.
 */
export function rosette(options: {
  cx: number;
  cy: number;
  R: number;
  r: number;
  d: number;
  /** Uniform scale applied around the centre. */
  scale?: number;
  /** Points per turn: more is smoother. */
  resolution?: number;
}): string {
  const { cx, cy, R, r, d, scale = 1, resolution = 220 } = options;
  const turns = r / gcd(R, r);
  const steps = Math.ceil(turns * resolution);
  const k = (R - r) / r;
  let path = '';
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * 2 * Math.PI;
    const x = cx + scale * ((R - r) * Math.cos(t) + d * Math.cos(k * t));
    const y = cy + scale * ((R - r) * Math.sin(t) - d * Math.sin(k * t));
    path += `${i === 0 ? 'M' : 'L'}${n(x)} ${n(y)}`;
  }
  return path;
}

/**
 * A band of interleaved sine waves across the note, like a security thread.
 * Returns one path per wave.
 */
export function waveBand(options: {
  width: number;
  y: number;
  amplitude: number;
  wavelength: number;
  count: number;
}): string[] {
  const { width, y, amplitude, wavelength, count } = options;
  const waves: string[] = [];
  for (let w = 0; w < count; w++) {
    const phase = (w / count) * 2 * Math.PI;
    let path = '';
    for (let x = 0; x <= width; x += 6) {
      const yy = y + amplitude * Math.sin((x / wavelength) * 2 * Math.PI + phase);
      path += `${x === 0 ? 'M' : 'L'}${n(x)} ${n(yy)}`;
    }
    waves.push(path);
  }
  return waves;
}
