# GodGesture 后端部署指南(1Panel 手动部署)

适用环境:自有 Ubuntu 服务器 + 1Panel 面板 + 已备案域名(ADR-0004)。
交付物:`apps/server/Dockerfile` + `apps/server/docker-compose.prod.yml`。
HTTPS 与反向代理由 1Panel(OpenResty)承担,应用只暴露 `127.0.0.1` 回环端口。

## 一、准备

1. 服务器已安装 1Panel,且 1Panel 内已启用 Docker(容器管理可用)。
2. 将仓库上传/克隆到服务器,例如 `/opt/godgesture`(整个仓库,Docker 构建需要 pnpm workspace 上下文)。

## 二、配置环境变量

```bash
cd /opt/godgesture/apps/server
cp .env.example .env
vim .env
```

必改项:

| 变量 | 说明 |
| --- | --- |
| `NODE_ENV` | 改为 `production` |
| `JWT_SECRET` | 长随机串:`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `PUBLIC_BASE_URL` | 你的 API 域名,如 `https://api.example.com`(OAuth 回调用) |
| `POSTGRES_PASSWORD` | 追加一行,PostgreSQL 密码(compose 用,`DATABASE_URL` 会被 compose 自动覆盖指向内网库) |
| `APP_PORT` | 可选,宿主机回环端口,默认 3000 |
| `OAUTH_GITHUB_*` / `OAUTH_GOOGLE_*` | 需要 OAuth 登录时填写;回调地址见 `.env.example` 注释 |

微信/QQ 登录默认停用(端点返回 501),将来在开放平台拿到资质后填 `OAUTH_WECHAT_*` / `OAUTH_QQ_*` 并置 `OAUTH_*_ENABLED=true` 即可,无需改代码。

## 三、构建并启动

```bash
cd /opt/godgesture/apps/server
docker compose -f docker-compose.prod.yml up -d --build
```

- 首次启动容器会自动执行 `prisma migrate deploy`(幂等),建好全部表结构。
- 验证:`curl http://127.0.0.1:3000/api/v1/health` 应返回 `{"status":"ok"}`。
- 查看日志:`docker compose -f docker-compose.prod.yml logs -f app`。

也可以在 1Panel「容器 → 编排」里粘贴 `docker-compose.prod.yml` 内容创建编排(注意把 `build.context` 换成服务器上的仓库根绝对路径,或先手动 `docker build -f apps/server/Dockerfile -t godgesture-server /opt/godgesture` 再把 `build:` 段删掉只留 `image:`)。

## 四、1Panel 反向代理 + HTTPS

1. 1Panel →「网站」→ 创建网站 → 反向代理:
   - 域名:`api.example.com`(已备案)
   - 代理地址:`http://127.0.0.1:3000`(与 `APP_PORT` 一致)
2. 该网站开启 HTTPS:1Panel「证书」申请 Let's Encrypt 证书并绑定,开启强制 HTTPS。
3. 建议在反代配置中保留默认的 `X-Forwarded-*` 头透传。

完成后对外地址:

- API 根:`https://api.example.com/api/v1/`
- Swagger 文档:`https://api.example.com/docs`(如不想公开,可在 1Panel 反代规则里屏蔽 `/docs`)

## 五、升级

```bash
cd /opt/godgesture && git pull
cd apps/server
docker compose -f docker-compose.prod.yml up -d --build
```

新迁移会在容器启动时自动应用;数据库数据在卷 `godgesture_pgdata` 中,升级不受影响。

## 六、备份与回滚

- 数据库备份(建议 1Panel 计划任务每日执行):

  ```bash
  docker exec $(docker ps -qf name=godgesture-postgres) \
    pg_dump -U godgesture godgesture | gzip > /opt/backup/godgesture-$(date +%F).sql.gz
  ```

- 恢复:`gunzip -c 备份文件 | docker exec -i <容器> psql -U godgesture godgesture`
- 用户配置层面的"回滚"走应用内快照机制(每次推送自动留存,保留最近 100 个版本),无需动数据库。

## 常见问题

- **容器起不来,日志报数据库连接失败**:确认 `postgres` 服务健康(`docker compose ps`),`POSTGRES_PASSWORD` 是否与首次初始化时一致(改密码需重建卷或在库内 `ALTER ROLE`)。
- **OAuth 回调 404 / redirect_uri 报错**:`PUBLIC_BASE_URL` 必须与实际对外域名完全一致(含 https);提供方后台的回调地址填 `{PUBLIC_BASE_URL}/api/v1/auth/oauth/<provider>/callback`。
- **端口冲突**:改 `.env` 里的 `APP_PORT`,同时更新 1Panel 反代地址。
