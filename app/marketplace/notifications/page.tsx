import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getRecentNotifications } from "@/lib/marketplace";
import { markAllNotificationsReadAction } from "@/app/marketplace/actions";
import { formatDate } from "@/lib/utils";

export default async function NotificationsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/marketplace/notifications");

  const notifications = await getRecentNotifications(profile.id);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
        <form action={markAllNotificationsReadAction}>
          <button type="submit" className="text-sm font-medium text-brand-blue hover:underline">
            Mark all read
          </button>
        </form>
      </div>

      {notifications.length === 0 ? (
        <p className="card p-8 text-center text-sm text-slate-400">You&rsquo;re all caught up.</p>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div key={n.id} className={`card p-4 ${n.is_read ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-slate-800">{n.title}</p>
                <span className="flex-shrink-0 text-xs text-slate-400">{formatDate(n.created_at)}</span>
              </div>
              {n.body ? <p className="mt-1 text-sm text-slate-500">{n.body}</p> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
