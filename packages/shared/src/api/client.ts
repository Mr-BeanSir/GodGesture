import createClient from "openapi-fetch";
import type { Client, ClientOptions } from "openapi-fetch";
import type { paths } from "./generated.js";

export type {
  components as GodGestureApiComponents,
  operations as GodGestureApiOperations,
  paths as GodGestureApiPaths,
} from "./generated.js";

export type GodGestureApiClient = Client<paths>;
export type GodGestureApiClientOptions = ClientOptions;

/**
 * Creates a transport-only API client from the generated OpenAPI contract.
 * Token storage, refresh rotation, and retry policy stay with each consumer.
 */
export function createGodGestureApiClient(
  options: GodGestureApiClientOptions = {},
): GodGestureApiClient {
  return createClient<paths>(options);
}
