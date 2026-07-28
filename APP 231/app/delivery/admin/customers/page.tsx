import { Users } from "lucide-react";
import { ComingSoon } from "@/components/vendor/ComingSoon";

export default function DeliveryAdminCustomersPage() {
  return (
    <ComingSoon
      icon={Users}
      title="Customers"
      description="A senders directory (order history, repeat-customer stats) isn't built yet — every order's sender is already visible from the Orders board."
    />
  );
}
