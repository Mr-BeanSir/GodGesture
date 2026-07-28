import {
  CloudError,
  extractCloudErrorCode,
  normalizeCloudError,
} from "./errors";

interface RuntimeSchema<T> {
  safeParse(
    value: unknown,
  ):
    { success: true; data: T } | { success: false; error: { issues: unknown } };
}

interface ApiResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

export async function apiData<T>(
  schema: RuntimeSchema<T>,
  request: Promise<ApiResult>,
  endpoint: string,
): Promise<T> {
  let result: ApiResult;
  try {
    result = await request;
  } catch (error) {
    throw normalizeCloudError(error, endpoint);
  }
  if (!result.response.ok) {
    throw new CloudError(
      result.response.status,
      extractCloudErrorCode(result.error) ?? `http_${result.response.status}`,
      result.error,
      endpoint,
    );
  }
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    throw new CloudError(
      result.response.status,
      "invalid_server_response",
      { response: result.data, issues: parsed.error.issues },
      endpoint,
    );
  }
  return parsed.data;
}

export async function apiVoid(
  request: Promise<ApiResult>,
  endpoint: string,
): Promise<void> {
  let result: ApiResult;
  try {
    result = await request;
  } catch (error) {
    throw normalizeCloudError(error, endpoint);
  }
  if (!result.response.ok) {
    throw new CloudError(
      result.response.status,
      extractCloudErrorCode(result.error) ?? `http_${result.response.status}`,
      result.error,
      endpoint,
    );
  }
}

export function responseErrorCode(response: Response): Promise<string | null> {
  return response
    .clone()
    .json()
    .then(extractCloudErrorCode)
    .catch(() => null);
}
