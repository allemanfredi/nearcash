/**
 * "Deposit received": the animation the kiosk plays when the customer's
 * payment arrives. An original Lottie animation, written here as data
 * (instead of exported from an editor) so every part can be read and
 * adjusted:
 *
 *   frames  0–24   a green disc grows from the centre, overshoots, settles
 *   frames 14–50   a thin ring spreads out from the disc and fades
 *   frames 14–52   eight dots burst outwards and fade
 *   frames 16–40   the check mark draws itself on the disc
 *   frames 52–90   still: the finished mark stays on screen
 *
 * 60 frames per second (1.5 s), on a 240 × 240 canvas that the player
 * scales to its box. Colours: NearCash green and the dark ink used on it.
 */

const FPS = 60;
const SIZE = 240;
const LAST_FRAME = 90;
const CENTRE = SIZE / 2;

/** Lottie colours are RGBA in 0–1. */
const GREEN = [0, 236 / 255, 151 / 255, 1]; // #00ec97
const INK = [3 / 255, 38 / 255, 25 / 255, 1]; // #032619

// ------------------------------------------------------------ value helpers

/** Bezier easing handles of a keyframe (one number per dimension, or one for all). */
type Easing = { x: number[]; y: number[] };
type Keyframe = { t: number; s: number[]; o?: Easing; i?: Easing };
type PathData = { i: number[][]; o: number[][]; v: number[][]; c: boolean };
type Value = { a: 0; k: number | number[] | PathData } | { a: 1; k: Keyframe[] };

/** Ease out of every keyframe: fast start, soft landing. */
const EASE_OUT = { o: { x: [0.3], y: [0] }, i: { x: [0.2], y: [1] } };

/** A value that never changes. */
function still(value: number | number[] | PathData): Value {
  return { a: 0, k: value };
}

/** A value that moves through [frame, value] steps (it holds the first value before, the last after). */
function animated(steps: [frame: number, value: number[]][]): Value {
  return {
    a: 1,
    k: steps.map(([t, s], index) => (index < steps.length - 1 ? { t, s, ...EASE_OUT } : { t, s })),
  };
}

// ------------------------------------------------------------ shape helpers

/** The transform every shape group ends with. */
function groupTransform(options: { position?: Value; scale?: Value; opacity?: Value } = {}) {
  return {
    ty: 'tr',
    p: options.position ?? still([0, 0]),
    a: still([0, 0]),
    s: options.scale ?? still([100, 100]),
    r: still(0),
    o: options.opacity ?? still(100),
    sk: still(0),
    sa: still(0),
  };
}

function group(name: string, items: object[], transform = groupTransform()) {
  return { ty: 'gr', nm: name, it: [...items, transform] };
}

/** A circle of diameter `size`, centred on the group's origin. */
function circle(size: Value) {
  return { ty: 'el', p: still([0, 0]), s: size, d: 1 };
}

function fill(colour: number[]) {
  return { ty: 'fl', c: still(colour), o: still(100), r: 1 };
}

/** A stroke with round ends and corners. */
function stroke(colour: number[], width: Value, opacity: Value = still(100)) {
  return { ty: 'st', c: still(colour), o: opacity, w: width, lc: 2, lj: 2, ml: 4 };
}

/** A shape layer centred on the canvas, alive for the whole animation. */
function layer(index: number, name: string, shapes: object[], scale: Value = still([100, 100, 100])) {
  return {
    ddd: 0,
    ind: index,
    ty: 4,
    nm: name,
    sr: 1,
    ks: {
      o: still(100),
      r: still(0),
      p: still([CENTRE, CENTRE, 0]),
      a: still([0, 0, 0]),
      s: scale,
    },
    ao: 0,
    shapes,
    ip: 0,
    op: LAST_FRAME,
    st: 0,
    bm: 0,
  };
}

// ------------------------------------------------------------ the parts

const DISC_SIZE = 140;

/** The check mark: two straight strokes, drawn from the short end (trim path 0 → 100 %). */
const check = layer(1, 'check', [
  group('check mark', [
    {
      ty: 'sh',
      ks: still({
        v: [
          [-30, 2],
          [-9, 23],
          [32, -20],
        ],
        i: [
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        o: [
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        c: false,
      }),
    },
    stroke(INK, still(13)),
  ]),
  {
    ty: 'tm',
    s: still(0),
    e: animated([
      [16, [0]],
      [40, [100]],
    ]),
    o: still(0),
    m: 1,
  },
]);

/** The green disc: grows from nothing to 112 %, then settles at 100 %. */
const disc = layer(
  2,
  'disc',
  [group('disc', [circle(still([DISC_SIZE, DISC_SIZE])), fill(GREEN)])],
  animated([
    [0, [0, 0, 100]],
    [16, [112, 112, 100]],
    [24, [100, 100, 100]],
  ]),
);

/** A thin ring leaving the disc's edge: wider, thinner, fainter. Hidden until frame 14. */
const ring = layer(3, 'ring', [
  group('ring', [
    circle(
      animated([
        [14, [DISC_SIZE, DISC_SIZE]],
        [50, [228, 228]],
      ]),
    ),
    stroke(
      GREEN,
      animated([
        [14, [8]],
        [50, [1]],
      ]),
      animated([
        [13, [0]],
        [14, [70]],
        [50, [0]],
      ]),
    ),
  ]),
]);

/** Eight dots around the disc, moving out from radius 78 to 112 while they fade. */
const DOT_COUNT = 8;
const dots = layer(
  4,
  'dots',
  Array.from({ length: DOT_COUNT }, (_, index) => {
    // Offset by half a step so no dot sits on the check mark's axis.
    const angle = ((index + 0.5) / DOT_COUNT) * 2 * Math.PI;
    const at = (radius: number) => [Math.round(Math.cos(angle) * radius * 10) / 10, Math.round(Math.sin(angle) * radius * 10) / 10];
    return group(
      `dot ${index + 1}`,
      [circle(still([10, 10])), fill(GREEN)],
      groupTransform({
        position: animated([
          [14, at(78)],
          [52, at(112)],
        ]),
        scale: animated([
          [14, [100, 100]],
          [52, [40, 40]],
        ]),
        opacity: animated([
          [13, [0]],
          [16, [100]],
          [52, [0]],
        ]),
      }),
    );
  }),
);

/** The animation document (Lottie / Bodymovin format). Layers listed first are drawn on top. */
export const depositReceivedAnimation = {
  v: '5.7.4',
  nm: 'deposit received',
  fr: FPS,
  ip: 0,
  op: LAST_FRAME,
  w: SIZE,
  h: SIZE,
  ddd: 0,
  assets: [],
  layers: [check, disc, ring, dots],
};
