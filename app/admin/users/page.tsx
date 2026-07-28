import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAllUsers } from "@/lib/super-admin";
import { getCurrentAuthUser } from "@/lib/user";
import { UsersManager } from "@/components/admin/UsersManager";

export const metadata: Metadata = {
  title: "Users & Roles — Super Admin",
};

export default async function UsersPage() {
  const currentUser = await getCurrentAuthUser();
  if (!currentUser) {
    redirect("/login?next=/admin/users");
    return null;
  }

  const users = await getAllUsers();

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Users & Roles</h1>
        <p className="text-sm text-slate-500">Every signed-up account, platform-wide. Change a role to change what they can access.</p>
      </div>

      <UsersManager users={users} currentUserId={currentUser.id} />
    </div>
  );
}
