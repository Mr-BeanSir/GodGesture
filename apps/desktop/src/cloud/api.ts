import {
  ListSnapshotsQuery,
  ListSnapshotsResponse,
  LoginRequest,
  MeResponse,
  OAuthExchangeRequest,
  OAuthPendingBindingCompleteRequest,
  OAuthPendingBindingEmailCodeRequest,
  RequestEmailCodeResponse,
  OAuthProvidersResponse,
  PullConfigResponse,
  PushConfigRequest,
  PushConfigResponse,
  RestoreSnapshotRequest,
  RestoreSnapshotResponse,
  TokenPairResponse,
  createGodGestureApiClient,
  type GodGestureApiClient,
  type GodGestureApiComponents,
  type LoginRequest as LoginInput,
  type ListSnapshotsQuery as ListSnapshotsInput,
  type OAuthExchangeRequest as OAuthExchangeInput,
  type OAuthProvider,
  type PushConfigRequest as PushConfigInput,
  type RestoreSnapshotRequest as RestoreSnapshotInput,
} from "@godgesture/shared";
import { CloudSession } from "./session";
import { apiData, apiVoid } from "./transport";

export class CloudApi {
  private readonly authClient: GodGestureApiClient;

  constructor(readonly session: CloudSession) {
    this.authClient = createGodGestureApiClient({
      baseUrl: session.apiBase,
      fetch: session.authenticatedFetch,
    });
  }

  async login(input: LoginInput): Promise<void> {
    const body = LoginRequest.parse(input);
    const pair = await apiData(
      TokenPairResponse,
      this.session.publicClient.POST("/auth/login", { body }),
      "/auth/login",
    );
    await this.session.installTokenPair(pair);
  }

  async exchangeOAuth(input: OAuthExchangeInput): Promise<void> {
    const body = OAuthExchangeRequest.parse(input);
    const pair = await apiData(
      TokenPairResponse,
      this.session.publicClient.POST("/auth/oauth/exchange", { body }),
      "/auth/oauth/exchange",
    );
    await this.session.installTokenPair(pair);
  }

  requestPendingOAuthEmailCode(bindingId: string, input: OAuthPendingBindingEmailCodeRequest): Promise<RequestEmailCodeResponse> {
    const body = OAuthPendingBindingEmailCodeRequest.parse(input);
    return apiData(RequestEmailCodeResponse, this.session.publicClient.POST('/auth/oauth/pending/{id}/email-code', { params: { path: { id: bindingId } }, body }), '/auth/oauth/pending/email-code');
  }

  async completePendingOAuthBinding(bindingId: string, input: OAuthPendingBindingCompleteRequest): Promise<void> {
    const body = OAuthPendingBindingCompleteRequest.parse(input);
    const pair = await apiData(TokenPairResponse, this.session.publicClient.POST('/auth/oauth/pending/{id}/complete', { params: { path: { id: bindingId } }, body }), '/auth/oauth/pending/complete');
    await this.session.installTokenPair(pair);
  }

  providers(): Promise<OAuthProvidersResponse> {
    return apiData(
      OAuthProvidersResponse,
      this.session.publicClient.GET("/auth/oauth/providers"),
      "/auth/oauth/providers",
    );
  }

  authorizeUrl(
    provider: OAuthProvider,
    redirectUri: string,
    state: string,
    codeChallenge: string,
  ): string {
    const url = new URL(
      `${this.session.apiBase}/auth/oauth/${provider}/authorize`,
    );
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  me(): Promise<MeResponse> {
    return apiData(MeResponse, this.authClient.GET("/auth/me"), "/auth/me");
  }

  logoutRemote(): Promise<void> {
    return apiVoid(this.authClient.POST("/auth/logout"), "/auth/logout");
  }

  pullConfig(): Promise<PullConfigResponse> {
    return apiData(
      PullConfigResponse,
      this.authClient.GET("/sync/config"),
      "/sync/config",
    );
  }

  pushConfig(input: PushConfigInput): Promise<PushConfigResponse> {
    const body = PushConfigRequest.parse(input);
    // Runtime parsing canonicalizes hotkey names. The established shared
    // ConfigDocument surface remains string[], while OpenAPI exposes the
    // narrower canonical-name enum expected on the wire.
    const transportBody =
      body as unknown as GodGestureApiComponents["schemas"]["PushConfigRequest"];
    return apiData(
      PushConfigResponse,
      this.authClient.PUT("/sync/config", { body: transportBody }),
      "/sync/config",
    );
  }

  listSnapshots(input: ListSnapshotsInput): Promise<ListSnapshotsResponse> {
    const query = ListSnapshotsQuery.parse(input);
    return apiData(
      ListSnapshotsResponse,
      this.authClient.GET("/sync/snapshots", {
        params: { query },
      }),
      "/sync/snapshots",
    );
  }

  restoreSnapshot(
    version: number,
    input: RestoreSnapshotInput,
  ): Promise<RestoreSnapshotResponse> {
    const body = RestoreSnapshotRequest.parse(input);
    return apiData(
      RestoreSnapshotResponse,
      this.authClient.POST("/sync/snapshots/{version}/restore", {
        params: { path: { version } },
        body,
      }),
      `/sync/snapshots/${version}/restore`,
    );
  }
}
