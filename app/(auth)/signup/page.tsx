import Image from "next/image";
import Link from "next/link";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/onlib-logo.jpg" alt="ONLib" width={140} height={48} className="h-10 w-auto object-contain" priority />
          </Link>
        </div>

        <div className="card p-8">
          <p className="text-sm text-slate-500">Two separate services, one account</p>
          <h1 className="mb-6 text-2xl font-bold text-slate-900">Create your account</h1>
          <SignupForm />
        </div>
      </div>
    </div>
  );
}
