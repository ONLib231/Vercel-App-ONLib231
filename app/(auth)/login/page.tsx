import Image from "next/image";
import Link from "next/link";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; confirm_email?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? "/";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/onlib-logo.jpg" alt="ONLib" width={140} height={48} className="h-10 w-auto object-contain" priority />
          </Link>
        </div>

        <div className="card p-8">
          <p className="text-sm text-slate-500">Please enter your details</p>
          <h1 className="mb-6 text-2xl font-bold text-slate-900">Welcome back</h1>

          {params.confirm_email ? (
            <p className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-brand-blue">
              Check your email to confirm your account, then log in below.
            </p>
          ) : null}

          <LoginForm next={next} />
        </div>
      </div>
    </div>
  );
}
