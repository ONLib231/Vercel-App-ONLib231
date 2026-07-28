"use client";

import { updateUserRoleAction } from "./actions";

const ROLES = ["customer", "vendor", "admin"] as const;

export function RoleSelect({ userId, role, disabled }: { userId: string; role: string; disabled?: boolean }) {
  return (
    <form action={updateUserRoleAction}>
      <input type="hidden" name="user_id" value={userId} />
      <select
        name="role"
        defaultValue={role}
        disabled={disabled}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-lg border border-slate-300 px-2 py-1 text-xs capitalize disabled:opacity-50"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </form>
  );
}
