import React from "react";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`rounded-lg border bg-white ${className ?? ""}`}>{children}</div>;
}
