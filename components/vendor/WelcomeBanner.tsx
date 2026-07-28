import { Store } from "lucide-react";

export interface WelcomeBannerProps {
  storeName: string;
  online?: boolean;
}

/** Dark navy "Welcome back, {store}" banner at the top of the Vendor Dashboard home, matching both mockups. */
export function WelcomeBanner({ storeName, online = true }: WelcomeBannerProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-gradient-to-br from-verta-900 to-verta-700 px-5 py-5 text-white sm:px-6">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
          <Store className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="text-xs text-white/70">Welcome back,</p>
          <p className="text-lg font-bold sm:text-xl">{storeName}</p>
        </div>
      </div>

      {online && (
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />
          Online
        </span>
      )}
    </div>
  );
}
