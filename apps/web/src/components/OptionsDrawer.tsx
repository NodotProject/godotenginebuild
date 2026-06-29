import { useMemo, useState } from "react";
import {
  effectiveDefault,
  type BuildOptionDef,
  type OptionCatalog,
  type OptionGroup,
  type OptionSelection,
  type OptionValue,
} from "@godotbuild/shared";

const GROUP_LABELS: Record<OptionGroup, string> = {
  optimization: "Optimization",
  subsystems: "Engine subsystems",
  rendering: "Rendering",
  components: "Components",
  modules: "Modules",
  builtin: "Built-in libraries",
};

const GROUP_ORDER: OptionGroup[] = [
  "optimization",
  "rendering",
  "subsystems",
  "components",
  "modules",
  "builtin",
];

interface Props {
  catalog: OptionCatalog;
  selection: OptionSelection;
  onChange: (key: string, value: OptionValue | undefined) => void;
}

function effectiveValue(def: BuildOptionDef, selection: OptionSelection): OptionValue {
  const v = selection[def.key];
  return v === undefined ? effectiveDefault(def, selection) : v;
}

function OptionControl({
  def,
  selection,
  onChange,
}: {
  def: BuildOptionDef;
  selection: OptionSelection;
  onChange: Props["onChange"];
}) {
  const value = effectiveValue(def, selection);
  const overridden = selection[def.key] !== undefined;

  const set = (next: OptionValue) =>
    onChange(def.key, next === effectiveDefault(def, selection) ? undefined : next);

  if (def.type === "bool") {
    return (
      <label className="flex items-start gap-2 py-1 cursor-pointer group" title={def.help}>
        <input
          type="checkbox"
          className="mt-1 accent-sky-500"
          checked={Boolean(value)}
          onChange={(e) => set(e.target.checked)}
        />
        <span className="text-sm">
          <span className={overridden ? "text-sky-300" : "text-slate-200"}>{def.label}</span>
          {def.help && (
            <span className="block text-xs text-slate-500 group-hover:text-slate-400">
              {def.help}
            </span>
          )}
        </span>
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1 py-1" title={def.help}>
      <span className="text-sm text-slate-200">{def.label}</span>
      <select
        className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
        value={String(value)}
        onChange={(e) => set(e.target.value)}
      >
        {def.values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      {def.help && <span className="text-xs text-slate-500">{def.help}</span>}
    </label>
  );
}

function GroupSection({
  group,
  options,
  selection,
  onChange,
  defaultOpen,
}: {
  group: OptionGroup;
  options: BuildOptionDef[];
  selection: OptionSelection;
  onChange: Props["onChange"];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [filter, setFilter] = useState("");
  const overrides = options.filter((o) => selection[o.key] !== undefined).length;

  const shown = useMemo(() => {
    if (!filter) return options;
    const f = filter.toLowerCase();
    return options.filter((o) => o.key.toLowerCase().includes(f) || o.label.toLowerCase().includes(f));
  }, [options, filter]);

  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/60 hover:bg-slate-800/60"
      >
        <span className="font-medium text-slate-100">
          {GROUP_LABELS[group]}
          <span className="ml-2 text-xs text-slate-500">{options.length}</span>
          {overrides > 0 && (
            <span className="ml-2 text-xs text-sky-400">{overrides} changed</span>
          )}
        </span>
        <span className="text-slate-500">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="p-3 space-y-1">
          {group === "modules" && (
            <input
              type="text"
              placeholder="Filter modules…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full mb-2 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
            />
          )}
          <div
            className={
              group === "modules"
                ? "grid grid-cols-1 sm:grid-cols-2 gap-x-4"
                : "space-y-1"
            }
          >
            {shown.map((def) => (
              <OptionControl key={def.key} def={def} selection={selection} onChange={onChange} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function OptionsDrawer({ catalog, selection, onChange }: Props) {
  const all = [...catalog.scons, ...catalog.modules];
  const byGroup = new Map<OptionGroup, BuildOptionDef[]>();
  for (const def of all) {
    const arr = byGroup.get(def.group) ?? [];
    arr.push(def);
    byGroup.set(def.group, arr);
  }

  return (
    <div className="space-y-2">
      {GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => (
        <GroupSection
          key={group}
          group={group}
          options={byGroup.get(group)!}
          selection={selection}
          onChange={onChange}
          defaultOpen={group === "optimization" || group === "rendering"}
        />
      ))}
    </div>
  );
}
