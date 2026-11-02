// The mark: a small sun on the horizon, drawn as a single fine line.
function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="size-6 shrink-0 sm:size-7" aria-hidden="true" fill="none">
      <circle cx="16" cy="16" r="14.5" className="stroke-plum" strokeWidth="1.5" />
      <path d="M8.5 19.5a7.5 7.5 0 0 1 15 0Z" className="fill-brass" />
      <path d="M7 19.5h18M10.5 23.5h11" className="stroke-plum" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const links = [
  { path: "/inventory", label: "Inventory" },
  { path: "/book", label: "Book" },
];

export default function Header({ path }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-paper/88 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-x-3 px-4 sm:gap-x-6 sm:px-6 lg:px-10">
        <a href="#/inventory" className="flex shrink-0 items-center gap-2.5 py-3.5 sm:gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-plum/[0.055] ring-1 ring-plum/10">
            <Mark />
          </span>
          <span className="whitespace-nowrap font-display text-[1.22rem] font-medium leading-none tracking-[-0.02em] sm:text-[1.4rem]">
            Ten Mission
          </span>
        </a>

        <nav aria-label="Main" className="flex shrink-0 rounded-full bg-plum/[0.045] p-1 ring-1 ring-plum/[0.06]">
          {links.map((link) => {
            // Anything that is not the booking page counts as the inventory page.
            const active = link.path === "/book" ? path === "/book" : path !== "/book";
            return (
              <a
                key={link.path}
                href={`#${link.path}`}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-full px-3.5 py-2 text-xs font-semibold transition sm:px-5 sm:text-sm ${
                  active
                    ? "bg-paper text-ink shadow-[0_3px_12px_rgba(33,19,41,0.08)] ring-1 ring-line"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {link.label}
              </a>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
