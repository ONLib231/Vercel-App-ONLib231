import { ClipboardList } from "lucide-react";
import { ComingSoon } from "@/components/vendor/ComingSoon";

export default function VendorOrdersPage() {
  return (
    <ComingSoon
      icon={ClipboardList}
      title="Orders"
      description="The full order list with filtering and fulfillment actions is coming in the next build — recent orders are already visible on your Dashboard home."
    />
  );
}
