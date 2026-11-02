import { initials } from "../utils/format.js";

export default function Avatar({ member, className = "size-10 text-lg" }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-plum/[0.075] font-display font-medium text-plum ring-1 ring-plum/10 ${className}`}
      aria-hidden="true"
    >
      {initials(member)}
    </span>
  );
}
