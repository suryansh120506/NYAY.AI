import { NewsFeedSkeleton } from "@/components/news/NewsFeedSkeleton";
import { RouteSkeleton, Skeleton } from "@/components/ui/Skeleton";

// Purely visual: see RouteSkeleton (docs/ASSUMPTIONS.md A29).
export default function UpdatesLoading() {
  return (
    <RouteSkeleton>
      <div className="h-14" />
      <div className="mx-auto max-w-page px-4 pt-10 md:px-6 md:pt-16">
        <Skeleton className="mb-3 h-5 w-80" />
        <NewsFeedSkeleton />
      </div>
    </RouteSkeleton>
  );
}
