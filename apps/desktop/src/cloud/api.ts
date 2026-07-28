import {
  ListSnapshotsResponse,
  LoginRequest,
  MeResponse,
  OAuthExchangeRequest,
  OAuthProvidersResponse,
  PullConfigResponse,
  PushConfigRequest,
  PushConfigResponse,
  RegisterRequest,
  RestoreSnapshotRequest,
  RestoreSnapshotResponse,
  TokenPairResponse,
  createGodGestureApiClient,
  type GodGestureApiClient,
  type GodGestureApiComponents,
  type LoginRequest as LoginInput,
  type MeResponse as AccountUser,
  type OAuthExchangeRequest as OAuthExchangeInput,
  type OAuthProvider,
  type PushConfigRequest as PushConfigInput,
  type RegisterRequest as RegisterInput,
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

  async register(input: RegisterInput): Promise<AccountUser> {
    const body = RegisterRequest.parse(input);
    return apiData(
      MeResponse,
      this.session.publicClient.POST("/auth/register", { body }),
      "/auth/register",
    );
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

  listSnapshots(): Promise<ListSnapshotsResponse> {
    return apiData(
      ListSnapshotsResponse,
      this.authClient.GET("/sync/snapshots"),
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
