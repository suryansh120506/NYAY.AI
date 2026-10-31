import { RouteSkeleton, Skeleton, SkeletonText } from "@/components/ui/Skeleton";

// Purely visual: see RouteSkeleton (docs/ASSUMPTIONS.md A29).
export default function LegalLoading() {
  return (
    <RouteSkeleton>
      <div className="h-14" />
      <div className="mx-auto max-w-prose px-4 py-section-sm">
        <Skeleton className="h-8 w-56" />
        <SkeletonText lines={3} className="mt-6" />
      </div>
    </RouteSkeleton>
  );
}
