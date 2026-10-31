/**
 * Client selection (brief rule 5). NEXT_PUBLIC_USE_MOCKS=true runs the whole web app on in-browser mocks;
 * false uses the FastAPI backend at NEXT_PUBLIC_API_URL. Each domain has its own getter module, so a page only
 * bundles the clients it uses.
 */
import { publicConfig } from "@/lib/config";

export const useHttp = !publicConfig.useMocks;
