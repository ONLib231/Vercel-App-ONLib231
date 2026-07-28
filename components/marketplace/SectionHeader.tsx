import Link from "next/link";

export interface SectionHeaderProps {
  title: string;
  viewAllHref: string;
  className?: string;
}

export function SectionHeader({ title, viewAllHref, className = "" }: SectionHeaderProps) {
  return (
    <div className={`mb-4 flex items-center justify-between ${className}`}>
      <h2 className="text-lg font-bold text-slate-800 sm:text-xl">{title}</h2>
      <Link href={viewAllHref} className="text-sm font-medium text-verta-600 hover:text-verta-700">
        View All
      </Link>
    </div>
  );
}
