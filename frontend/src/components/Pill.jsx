const tones = {
  neutral: "bg-plum/[0.06] text-ink-soft",
  good: "bg-moss/10 text-moss",
  low: "bg-brass/15 text-brass-text",
  bad: "bg-wine/10 text-wine",
  muted: "bg-slate/10 text-slate",
};

export default function Pill({ tone = "neutral", children }) {
  return (
    <span className={`inline-block shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.02em] ${tones[tone]}`}>
      {children}
    </span>
  );
}
