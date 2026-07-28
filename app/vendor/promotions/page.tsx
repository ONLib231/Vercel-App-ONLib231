import { Tag } from "lucide-react";
import { ComingSoon } from "@/components/vendor/ComingSoon";

export default function VendorPromotionsPage() {
  return (
    <ComingSoon
      icon={Tag}
      title="Promotions"
      description="Discount codes and store-wide promos are coming in the next build."
    />
  );
}
