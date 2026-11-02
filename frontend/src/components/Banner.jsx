import { AlertCircle, CheckCircle2, Info } from "lucide-react";

const tones = {
  error: { Icon: AlertCircle, box: "bg-wine/[0.05] ring-wine/25", icon: "text-wine", role: "alert" },
  success: { Icon: CheckCircle2, box: "bg-moss/[0.06] ring-moss/25", icon: "text-moss", role: "status" },
  info: { Icon: Info, box: "bg-paper ring-line", icon: "text-ink-soft", role: "status" },
};

// Errors are announced to screen readers straight away.
export default function Banner({ tone = "info", title, children, action }) {
  const { Icon, box, icon, role } = tones[tone];
  return (
    <div role={role} className={`flex flex-wrap items-start gap-x-3 gap-y-2 rounded-2xl px-4 py-3.5 ring-1 ${box}`}>
      <Icon size={20} className={`mt-0.5 shrink-0 ${icon}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-48 text-sm">
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-ink-soft">{children}</div>
      </div>
      {action}
    </div>
  );
}
