import { Skeleton, SkeletonRegion, SkeletonText } from "@/components/ui/Skeleton";
import { bentoTiles, TILE_CLASSES } from "@/lib/news/bento";

/**
 * Same footprint as the real feed so nothing shifts when it resolves (brief §3.5 CLS < 0.05).
 * Takes its label as a prop: it is also used by route-level loading.tsx, which must not call next-intl (A29).
 */
export function NewsFeedSkeleton({
  withHeader = true,
  label,
}: {
  withHeader?: boolean;
  label?: string;
}) {
  const body = (
    <>
      {withHeader ? (
        <>
          <Skeleton className="h-8 w-48" />
          <div className="mt-6 flex gap-2" aria-hidden="true">
            {[72, 120, 112, 88, 104].map((w) => (
              <div key={w} style={{ width: w }} className="shrink-0">
                <Skeleton rounded="control" className="h-11 w-full" />
              </div>
            ))}
          </div>
        </>
      ) : null}
      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {bentoTiles(5).map((tile, i) => (
          <li key={i} className={TILE_CLASSES[tile]}>
            <div className="flex h-full flex-col overflow-hidden rounded-card border border-hairline bg-surface">
              <Skeleton
                rounded="card"
                className={
                  tile === "feature"
                    ? "aspect-[16/10] w-full lg:aspect-auto lg:min-h-72 lg:flex-1"
                    : "aspect-[16/10] w-full"
                }
              />
              <div className="p-4 md:p-5">
                <Skeleton className="h-3 w-32" />
                <SkeletonText
                  lines={tile === "feature" ? 2 : 3}
                  className="mt-3"
                  lineClassName={tile === "feature" ? "h-7" : "h-5"}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
  return label ? (
    <SkeletonRegion label={label}>{body}</SkeletonRegion>
  ) : (
    <div aria-busy="true">{body}</div>
  );
}
