// One option in a pick-one list. It is a real radio button underneath, so
// arrow keys, Tab and screen readers all work. The look is drawn around it.
// "relative" keeps the hidden input inside its row. Without it the input is
// placed against the whole page and makes the page taller than its content.
export default function ChoiceRow({ name, checked, disabled, onChange, leading, title, detail, badge, serifTitle = false }) {
  return (
    <label className="group relative block cursor-pointer has-[:disabled]:cursor-not-allowed">
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
      <div
        className="flex min-h-16 items-center gap-3 rounded-2xl bg-paper px-3.5 py-3 ring-1 ring-line transition duration-200
          hover:bg-pearl/35 hover:ring-line-strong
          group-has-[:checked]:bg-plum/[0.045] group-has-[:checked]:shadow-[0_8px_22px_-18px_rgba(53,32,64,0.55)] group-has-[:checked]:ring-2 group-has-[:checked]:ring-plum
          group-has-[:focus-visible]:outline-2 group-has-[:focus-visible]:outline-offset-2 group-has-[:focus-visible]:outline-plum
          group-has-[:disabled]:opacity-60"
      >
        {leading}
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${serifTitle ? "font-display text-lg font-medium leading-snug" : "font-medium"}`}>
            {title}
          </span>
          <span className="block text-sm leading-snug text-ink-soft">{detail}</span>
        </span>
        {badge}
      </div>
    </label>
  );
}
