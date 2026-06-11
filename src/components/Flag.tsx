import React from "react";
import { teamFlagUrl } from "../teams";

// Country flag from flagcdn.com. Renders nothing for unmapped names or
// knockout placeholders (e.g. "2A", "W73").
const Flag: React.FC<{ team: string; className?: string }> = ({ team, className }) => {
  const src = teamFlagUrl(team, 20);
  if (!src) return null;
  return (
    <img
      src={src}
      srcSet={`${teamFlagUrl(team, 40)} 2x`}
      alt=""
      loading="lazy"
      className={`inline-block h-3.5 w-5 shrink-0 rounded-[2px] object-cover align-middle ring-1 ring-black/5 ${className ?? ""}`}
    />
  );
};

export default Flag;
