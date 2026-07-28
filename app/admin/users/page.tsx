import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RoleSelect } from "./RoleSelect";
import { formatDate } from "@/lib/utils";
import type { Tables } from "@/lib/supabase/database.types";

export default async function UsersPage() {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const { data: users }: { data: Tables<"profiles">[] | null } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Users</h1>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Joined</th>
              <th className="px-3 py-2">Role</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((user) => (
              <tr key={user.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-3 font-medium text-slate-800">{user.full_name ?? "—"}</td>
                <td className="px-3 py-3 text-slate-500">{formatDate(user.created_at)}</td>
                <td className="px-3 py-3">
                  <RoleSelect userId={user.id} role={user.role} disabled={user.id === admin.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
