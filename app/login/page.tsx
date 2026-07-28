import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Log In — ONLib",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  return (
    <AuthCard eyebrow="Please enter your details" title="Welcome back">
      <LoginForm next={searchParams.next} />
    </AuthCard>
  );
}
