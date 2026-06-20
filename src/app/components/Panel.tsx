import type { ReactNode } from "react";
import clsx from "clsx";

export function Panel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={clsx(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border border-edge bg-panel",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-2.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
        {title}
      </h2>
      {right}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-white/35">
      {children}
    </div>
  );
}
