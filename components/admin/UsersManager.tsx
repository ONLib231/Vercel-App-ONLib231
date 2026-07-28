"use client";

import { useState, useTransition } from "react";
import { updateUserRole } from "@/lib/actions/super-admin";
import type { UserManagementRow } from "@/types/super-admin";
import type { ProfileRow } from "@/types/vendor";

const ROLES: ProfileRow["role"][] = ["customer", "vendor", "driver", "admin"];

const ROLE_STYLES: Record<ProfileRow["role"], string> = {
  customer: "bg-slate-100 text-slate-600",
  vendor: "bg-onlib-50 text-onlib-700",
  driver: "bg-sky-50 text-sky-700",
  admin: "bg-verta-50 text-verta-700",
};

export interface UsersManagerProps {
  users: UserManagementRow[];
  currentUserId: string;
}

export function UsersManager({ users, currentUserId }: UsersManagerProps) {
  return (
    <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white shadow-sm">
      {users.map((user) => (
        <UserRow key={user.id} user={user} isSelf={user.id === currentUserId} />
      ))}
      {users.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-400">No users yet.</li>}
    </ul>
  );
}

function UserRow({ user, isSelf }: { user: UserManagementRow; isSelf: boolean }) {
  const [role, setRole] = useState(user.role);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(newRole: ProfileRow["role"]) {
    const previousRole = role;
    setRole(newRole);
    setError(null);
    startTransition(async () => {
      const result = await updateUserRole(user.id, newRole);
      if (!result.ok) {
        setRole(previousRole);
        setError(result.error ?? "Couldn't update this user's role.");
      }
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800">
          {user.full_name ?? "Unnamed"} {isSelf && <span className="text-xs font-normal text-slate-400">(you)</span>}
        </p>
        <p className="truncate text-xs text-slate-400">{user.email ?? "No email on file"}</p>
        {error && <p className="text-xs text-onlib-600">{error}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ROLE_STYLES[role]}`}>{role}</span>
        <select
          value={role}
          disabled={isPending || (isSelf && role === "admin")}
          onChange={(e) => handleChange(e.target.value as ProfileRow["role"])}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs disabled:opacity-50"
          title={isSelf && role === "admin" ? "Have another admin change your role" : undefined}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}
