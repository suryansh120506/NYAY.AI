import { NewsFeedSkeleton } from "@/components/news/NewsFeedSkeleton";
import { RouteSkeleton, Skeleton } from "@/components/ui/Skeleton";

// Purely visual: see RouteSkeleton (docs/ASSUMPTIONS.md A29).
export default function HomeLoading() {
  return (
    <RouteSkeleton>
      <div className="h-14" />
      <div className="flex min-h-[calc(88dvh-56px)] flex-col items-center justify-center px-4">
        <Skeleton className="h-16 w-full max-w-[560px]" />
        <Skeleton className="mt-6 h-6 w-full max-w-[420px]" />
        <Skeleton rounded="control" className="mt-12 h-[68px] w-full max-w-[720px]" />
      </div>
      <div className="mx-auto max-w-page px-4 md:px-6">
        <NewsFeedSkeleton />
      </div>
    </RouteSkeleton>
  );
}
