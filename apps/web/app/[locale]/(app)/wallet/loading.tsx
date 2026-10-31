import { RouteSkeleton, Skeleton } from "@/components/ui/Skeleton";

// Purely visual: see RouteSkeleton (docs/ASSUMPTIONS.md A29).
export default function WalletLoading() {
  return (
    <RouteSkeleton>
      <div className="h-14" />
      <div className="mx-auto max-w-prose px-4 pt-8 md:pt-12">
        <Skeleton className="h-8 w-32" />
        <Skeleton rounded="card" className="mt-8 h-36 w-full" />
        <Skeleton className="mt-10 h-6 w-40" />
        <Skeleton rounded="control" className="mt-4 h-11 w-full max-w-sm" />
        <Skeleton rounded="control" className="mt-6 h-14 w-full" />
      </div>
    </RouteSkeleton>
  );
}
