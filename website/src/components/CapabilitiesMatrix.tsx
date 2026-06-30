import type { CapabilityGroup } from "@/lib/productCapabilities";

type CapabilitiesMatrixProps = {
  groups: CapabilityGroup[];
};

export function CapabilitiesMatrix({ groups }: CapabilitiesMatrixProps) {
  let itemCounter = 0;

  return (
    <div className="mt-10 overflow-hidden rounded-sm border border-coop-border bg-coop-editor">
      {groups.map((group, groupIndex) => (
        <div key={group.label}>
          <div
            className={`border-coop-border bg-coop-surface/40 px-5 py-3 ${
              groupIndex > 0 ? "border-t" : ""
            }`}
          >
            <p className="coop-section-label">
              <span className="text-gray-400">{"// "}</span>
              {group.label}
            </p>
          </div>
          <ul className="divide-y divide-coop-border">
            {group.items.map((item) => {
              itemCounter += 1;
              return (
                <li
                  key={item.title}
                  className="grid gap-x-6 gap-y-2 px-5 py-5 sm:grid-cols-[2.75rem_minmax(0,11rem)_minmax(0,1fr)] sm:items-start"
                >
                  <span className="font-mono text-xs leading-5 text-coop-index sm:pt-0.5">
                    {String(itemCounter).padStart(2, "0")}
                  </span>
                  <h3 className="font-semibold text-gray-900">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-coop-muted">{item.body}</p>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
