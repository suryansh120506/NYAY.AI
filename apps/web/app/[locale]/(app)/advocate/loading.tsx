import { RouteSkeleton, Skeleton } from "@/components/ui/Skeleton";

// Purely visual: see RouteSkeleton (docs/ASSUMPTIONS.md A29).
export default function AdvocateDeskLoading() {
  return (
    <RouteSkeleton>
      <div className="h-14" />
      <div className="mx-auto max-w-prose px-4 pt-8 md:pt-12">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-10 h-6 w-32" />
        <Skeleton rounded="card" className="mt-4 h-24 w-full" />
        <Skeleton rounded="card" className="mt-10 h-36 w-full" />
      </div>
    </RouteSkeleton>
  );
}
