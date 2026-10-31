import { RouteSkeleton, Skeleton } from "@/components/ui/Skeleton";

// Purely visual: see RouteSkeleton (docs/ASSUMPTIONS.md A29).
export default function ParakhLoading() {
  return (
    <RouteSkeleton>
      <div className="h-14" />
      <div className="mx-auto max-w-prose px-4 pt-6 md:pt-10">
        <Skeleton rounded="control" className="h-14 w-full" />
        <Skeleton className="mt-10 h-6 w-2/3" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} rounded="card" className="mt-4 h-56 w-full" />
        ))}
      </div>
    </RouteSkeleton>
  );
}
