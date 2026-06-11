import React from "react";

export function Badge({
  variant,
  className,
  children,
}: {
  variant?: "secondary" | "default";
  className?: string;
  children: React.ReactNode;
}) {
  const v =
    variant === "secondary" ? "bg-slate-100 text-slate-600" : "bg-slate-900 text-white";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${v} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}
