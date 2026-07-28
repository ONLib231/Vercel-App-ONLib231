import { PlusCircle } from "lucide-react";
import { ComingSoon } from "@/components/vendor/ComingSoon";

export default function NewVendorProductPage() {
  return (
    <ComingSoon
      icon={PlusCircle}
      title="Add Product"
      description="The new-product form (name, price, images, category) is coming in the next build."
    />
  );
}
