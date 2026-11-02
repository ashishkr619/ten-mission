// One place for button styles. min-h keeps every button easy to press on a touch screen.
const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-50";

const sizes = {
  md: "min-h-11 px-5 py-2.5 text-sm",
  sm: "min-h-9 px-4 py-1.5 text-xs",
};

const variants = {
  primary: "bg-plum text-white shadow-[0_8px_22px_-10px_rgba(53,32,64,0.65)] hover:-translate-y-0.5 hover:bg-plum-deep hover:shadow-[0_12px_26px_-10px_rgba(53,32,64,0.7)]",
  quiet: "bg-paper text-ink ring-1 ring-line-strong hover:-translate-y-0.5 hover:ring-ink/45",
  danger: "bg-paper text-wine ring-1 ring-wine/25 hover:bg-wine/5 hover:ring-wine/45",
  dangerSolid: "bg-wine text-white hover:bg-wine/90",
};

// buttonClass("primary", { size: "sm", extra: "w-full" })
export const buttonClass = (variant = "quiet", { size = "md", extra = "" } = {}) =>
  `${base} ${sizes[size]} ${variants[variant]} ${extra}`;
