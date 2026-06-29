import type { ReactNode } from "react";

/** Shared shell for the static legal pages (privacy, terms). */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <a href="/" className="text-sm text-sky-400 hover:text-sky-300">
          ← Back to builder
        </a>
        <h1 className="text-3xl font-bold text-white mt-4 mb-6">{title}</h1>
        <div className="space-y-4 text-slate-300 text-sm leading-relaxed [&_h2]:text-white [&_h2]:font-semibold [&_h2]:text-lg [&_h2]:mt-8 [&_h2]:mb-2 [&_a]:text-sky-400 [&_a:hover]:text-sky-300 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1">
          {children}
        </div>
        <footer className="mt-12 text-xs text-slate-600">
          Custom Godot Builds is a free, open-source tool. Godot Engine is a trademark of the Godot
          Foundation; this service is not affiliated with or endorsed by the Godot project.
        </footer>
      </div>
    </div>
  );
}
