import type { DeliveryOrderStatus } from "@/types/delivery";

const STYLES: Record<DeliveryOrderStatus, string> = {
  pending: "bg-amber-50 text-amber-700",
  accepted: "bg-verta-50 text-verta-700",
  picked_up: "bg-sky-50 text-sky-700",
  delivered: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-500",
};

export function StatusBadge({ status, label }: { status: DeliveryOrderStatus; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STYLES[status]}`}>
      {label}
    </span>
  );
}
