import { useId } from "react";
import { TONES, contourLines, hash } from "../art/contours.js";

// The artwork for an experience: fine brass contour lines on a deep, quiet tone.
// It only needs { title, id }. The same experience always gets the same artwork.
// The svg fills its parent and crops itself to fit, so size it with className.
export default function ContourArt({ item, className = "" }) {
  const uid = useId().replace(/:/g, ""); // svg ids cannot contain ":"
  const seed = hash(`${item.title}:${item.id}`);
  const tone = TONES[seed % TONES.length];

  return (
    <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`tone${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={tone.from} />
          <stop offset="1" stopColor={tone.to} />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill={`url(#tone${uid})`} />
      {contourLines(seed).map((line, i) => (
        <path
          key={i}
          d={line.d}
          fill="none"
          className="stroke-brass-light"
          strokeOpacity={line.major ? 0.7 : 0.32}
          strokeWidth={line.major ? 1 : 0.7}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
