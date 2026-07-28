import { BarChart3 } from "lucide-react";
import { ComingSoon } from "@/components/vendor/ComingSoon";

export default function DeliveryAdminReportsPage() {
  return (
    <ComingSoon
      icon={BarChart3}
      title="Reports"
      description="PDF/exportable revenue and expense reports aren't ported yet — the original app generated these client-side with jsPDF. A 30-day revenue figure is already on your Dashboard home."
    />
  );
}
