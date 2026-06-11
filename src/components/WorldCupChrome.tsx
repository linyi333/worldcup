import React from "react";
import { useLang } from "../lang";
import { wcT } from "../i18n";

// Standalone site header (FIFA-themed) with the language switcher.

export const WorldCupHeader: React.FC = () => {
  const { lang, setLang } = useLang();
  const langBtn = (code: "zh" | "en", label: string) => (
    <button
      onClick={() => setLang(code)}
      className={`px-2.5 py-1 rounded-full text-sm transition-colors ${
        lang === code
          ? "bg-[#2A398D] text-white font-medium"
          : "text-slate-500 hover:text-slate-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <header className="bg-white border-b border-slate-200">
      <div className="container mx-auto max-w-4xl px-4 py-5 flex items-center justify-between gap-4">
        <div className="font-noto-sans-sc">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2 text-[#2A398D]">
            <span className="text-2xl md:text-3xl text-amber-500">⚽</span>
            {wcT(lang, "pageTitle")}
          </h1>
          <p className="text-sm text-slate-500 mt-1.5">{wcT(lang, "pageSubtitle")}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {langBtn("zh", "中文")}
          {langBtn("en", "EN")}
        </div>
      </div>
      {/* Tri-color stripe — adidas TRIONDA / three host nations
          (red = Canada, green = Mexico, blue = USA) */}
      <div className="flex h-1.5">
        <div className="flex-1 bg-[#E61D25]" />
        <div className="flex-1 bg-[#3CAC3B]" />
        <div className="flex-1 bg-[#2A398D]" />
      </div>
    </header>
  );
};
