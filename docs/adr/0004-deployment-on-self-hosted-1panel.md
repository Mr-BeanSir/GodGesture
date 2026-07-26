# 后端部署于自有 Ubuntu 服务器(1Panel),交付物为 docker-compose

生产环境是维护者自有的 Ubuntu 服务器,由 1Panel 管理,已有 ICP 备案域名;部署由维护者手动执行,不做自动化发布流水线。因此后端交付物形态为:`Dockerfile` + 生产 `docker-compose.yml`(NestJS + PostgreSQL),HTTPS 与反向代理由 1Panel(OpenResty)承担,应用只暴露内部端口。开发环境约定:Node 进程跑在宿主机(pnpm dev),PostgreSQL 等组件用 `docker-compose.dev.yml` 启动。

这是代码里看不出来的外部约束,记录在此以免未来有人往 CI/CD 自动部署或云厂商专有服务(RDS、Serverless)方向"优化"。

## 运行边界与限流

- 当前生产拓扑固定为一个 NestJS 实例，因此请求限流使用进程内有界计数器；扩展为多实例前必须先改为共享存储，不能让各实例独立放大额度。
- 1Panel/OpenResty 是唯一一跳可信反向代理，生产设置 `TRUST_PROXY_HOPS=1`；本地直连默认为 `0`，禁止无条件信任任意 `X-Forwarded-For`。
- 容器内监听 `0.0.0.0`，但宿主机端口只绑定 `127.0.0.1`；开发 PostgreSQL 同样只绑定宿主机回环。
- 生产镜像以 `node` 非 root 用户运行，Swagger 只在非生产环境挂载；JSON 与 URL-encoded 请求体使用显式上限，不依赖框架默认值。
