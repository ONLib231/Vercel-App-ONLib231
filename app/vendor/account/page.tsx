import { UserRound } from "lucide-react";
import { ComingSoon } from "@/components/vendor/ComingSoon";

export default function VendorAccountPage() {
  return (
    <ComingSoon
      icon={UserRound}
      title="Account"
      description="Your vendor profile details are coming in the next build — for now, manage sign-out from the header menu."
    />
  );
}
