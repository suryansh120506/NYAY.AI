import { RouteSkeleton, Skeleton } from "@/components/ui/Skeleton";

// Purely visual: see RouteSkeleton (docs/ASSUMPTIONS.md A29).
export default function SamvaadLoading() {
  return (
    <RouteSkeleton className="flex h-dvh flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-hairline px-4">
        <Skeleton rounded="circle" className="h-11 w-11" />
        <div className="flex-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-20" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-prose flex-1 px-4 py-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton rounded="card" className="mt-6 h-24 w-full" />
        <Skeleton rounded="card" className="mt-4 h-40 w-full" />
      </div>
    </RouteSkeleton>
  );
}
