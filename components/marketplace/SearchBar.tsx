import { Search, SlidersHorizontal } from "lucide-react";

export interface SearchBarProps {
  placeholder?: string;
  className?: string;
  /** Server Action or form-action URL; the search bar degrades to a plain
   *  GET form so it works without client JS. */
  action?: string;
}

export function SearchBar({
  placeholder = "Search products, stores...",
  className = "",
  action = "/marketplace/search",
}: SearchBarProps) {
  return (
    <form
      action={action}
      method="GET"
      role="search"
      className={`flex w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 shadow-sm ${className}`}
    >
      <Search className="h-[18px] w-[18px] shrink-0 text-slate-400" aria-hidden />
      <input
        type="search"
        name="q"
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
      />
      <button
        type="submit"
        aria-label="Filter search"
        className="tap-target flex shrink-0 items-center justify-center rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      >
        <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden />
      </button>
    </form>
  );
}
