"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { approveVendorApplicationAction, rejectVendorApplicationAction, type ReviewState } from "./actions";
import { formatDate } from "@/lib/utils";
import type { Tables } from "@/lib/supabase/database.types";

const initialState: ReviewState = { error: null };

function ApproveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary px-4 py-1.5 text-xs sm:w-auto" disabled={pending}>
      {pending ? "Approving…" : "Approve"}
    </button>
  );
}

function RejectButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-danger px-4 py-1.5 text-xs" disabled={pending}>
      {pending ? "Rejecting…" : "Confirm reject"}
    </button>
  );
}

export function VendorApplicationRow({
  application,
  businessRegistrationUrl,
  idDocumentUrl,
}: {
  application: Tables<"vendor_applications">;
  businessRegistrationUrl: string | null;
  idDocumentUrl: string | null;
}) {
  const [approveState, approveAction] = useFormState(approveVendorApplicationAction, initialState);
  const [rejectState, rejectAction] = useFormState(rejectVendorApplicationAction, initialState);
  const [showReject, setShowReject] = useState(false);

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold text-slate-900">{application.business_name}</p>
          <p className="text-xs text-slate-400">
            {application.id_document_type.replace("_", " ")} · Submitted {formatDate(application.created_at)}
          </p>
        </div>
        <StatusBadge status={application.status} />
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        {businessRegistrationUrl ? (
          <a href={businessRegistrationUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-blue hover:underline">
            View business registration
          </a>
        ) : (
          <span className="text-slate-400">No business registration on file</span>
        )}
        {idDocumentUrl ? (
          <a href={idDocumentUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-blue hover:underline">
            View ID document
          </a>
        ) : (
          <span className="text-slate-400">No ID document on file</span>
        )}
      </div>

      {application.status === "pending" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <form action={approveAction}>
            <input type="hidden" name="application_id" value={application.id} />
            <ApproveButton />
          </form>

          {!showReject ? (
            <button type="button" onClick={() => setShowReject(true)} className="text-xs font-medium text-brand-red hover:underline">
              Reject…
            </button>
          ) : (
            <form action={rejectAction} className="flex flex-1 items-center gap-2">
              <input type="hidden" name="application_id" value={application.id} />
              <input name="reason" placeholder="Reason (optional)" className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs" />
              <RejectButton />
            </form>
          )}

          {approveState.error ? <span className="text-xs text-brand-red">{approveState.error}</span> : null}
          {rejectState.error ? <span className="text-xs text-brand-red">{rejectState.error}</span> : null}
        </div>
      ) : application.status === "rejected" && application.rejection_reason ? (
        <p className="mt-3 text-xs text-brand-red">Reason: {application.rejection_reason}</p>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-slate-200 text-slate-500",
  };
  return <span className={`badge ${styles[status] ?? "bg-slate-100 text-slate-600"}`}>{status}</span>;
}
