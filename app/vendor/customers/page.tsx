import { Users } from "lucide-react";
import { ComingSoon } from "@/components/vendor/ComingSoon";

export default function VendorCustomersPage() {
  return (
    <ComingSoon
      icon={Users}
      title="Customers"
      description="A directory of buyers who've purchased from your store is coming in the next build."
    />
  );
}
