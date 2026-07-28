import { MessageSquare } from "lucide-react";
import { ComingSoon } from "@/components/vendor/ComingSoon";

export default function VendorMessagesPage() {
  return (
    <ComingSoon
      icon={MessageSquare}
      title="Messages"
      description="Customer conversations will land here — coming in the next build."
    />
  );
}
