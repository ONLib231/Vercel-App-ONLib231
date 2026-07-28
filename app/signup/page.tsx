import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignupForm } from "@/components/auth/SignupForm";

export const metadata: Metadata = {
  title: "Create Account — ONLib",
};

export default function SignupPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  return (
    <AuthCard eyebrow="Join ONLib" title="Create your account">
      <SignupForm next={searchParams.next} />
    </AuthCard>
  );
}
