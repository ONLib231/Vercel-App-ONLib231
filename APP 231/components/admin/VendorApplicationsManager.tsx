"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, IdCard } from "lucide-react";
import { reviewVendorApplication } from "@/lib/actions/super-admin";
import type { VendorApplicationReviewItem } from "@/types/super-admin";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-onlib-50 text-onlib-700",
};

const ID_DOCUMENT_LABELS: Record<string, string> = {
  passport: "Passport",
  national_id: "National ID",
  drivers_license: "Driver's License",
};

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

export interface VendorApplicationsManagerProps {
  applications: VendorApplicationReviewItem[];
}

export function VendorApplicationsManager({ applications }: VendorApplicationsManagerProps) {
  return (
    <ul className="space-y-3">
      {applications.map((application) => (
        <ApplicationCard key={application.id} application={application} />
      ))}
      {applications.length === 0 && (
        <li className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          No applications here.
        </li>
      )}
    </ul>
  );
}

function ApplicationCard({ application }: { application: VendorApplicationReviewItem }) {
  const router = useRouter();
  const [notes, setNotes] = useState(application.reviewer_notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDecision(decision: "approved" | "rejected") {
    setError(null);
    startTransition(async () => {
      const result = await reviewVendorApplication(application.id, decision, notes);
      if (!result.ok) {
        setError(result.error ?? "Couldn't save this decision.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">{application.business_name}</p>
          <p className="text-xs text-slate-500">
            {application.applicantName ?? "Unknown applicant"}
            {application.applicantPhone ? ` — ${application.applicantPhone}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Submitted {new Date(application.submitted_at).toLocaleDateString()} · ID type:{" "}
            {ID_DOCUMENT_LABELS[application.id_document_type] ?? application.id_document_type}
          </p>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[application.status]}`}>
          {capitalize(application.status)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {application.businessRegistrationUrl && (
          <a
            href={application.businessRegistrationUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            Business registration
          </a>
        )}
        {application.idDocumentUrl && (
          <a
            href={application.idDocumentUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <IdCard className="h-3.5 w-3.5" aria-hidden />
            ID document
          </a>
        )}
      </div>

      {application.status === "pending" ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reviewer notes (optional, shown if you reject)"
            rows={2}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          {error && <p className="text-sm text-onlib-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => handleDecision("approved")}
              disabled={isPending}
              className="rounded-full bg-verta-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-verta-700 disabled:opacity-60"
            >
              Approve
            </button>
            <button
              onClick={() => handleDecision("rejected")}
              disabled={isPending}
              className="rounded-full border border-onlib-100 px-4 py-1.5 text-xs font-semibold text-onlib-700 hover:bg-onlib-50 disabled:opacity-60"
            >
              Reject
            </button>
          </div>
        </div>
      ) : (
        application.reviewer_notes && <p className="mt-3 text-xs italic text-slate-400">Note: {application.reviewer_notes}</p>
      )}
    </li>
  );
}
