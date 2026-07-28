import { Settings } from "lucide-react";
import { ComingSoon } from "@/components/vendor/ComingSoon";

export default function VendorSettingsPage() {
  return (
    <ComingSoon
      icon={Settings}
      title="Store Settings"
      description="Store profile, payout details, and notification preferences are coming in the next build."
    />
  );
}
