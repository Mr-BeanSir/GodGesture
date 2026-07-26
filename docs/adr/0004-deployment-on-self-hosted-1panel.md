# 后端部署于自有 Ubuntu 服务器(1Panel),交付物为 docker-compose

生产环境是维护者自有的 Ubuntu 服务器,由 1Panel 管理,已有 ICP 备案域名;部署由维护者手动执行,不做自动化发布流水线。因此后端交付物形态为:`Dockerfile` + 生产 `docker-compose.yml`(NestJS + PostgreSQL),HTTPS 与反向代理由 1Panel(OpenResty)承担,应用只暴露内部端口。开发环境约定:Node 进程跑在宿主机(pnpm dev),PostgreSQL 等组件用 `docker-compose.dev.yml` 启动。

这是代码里看不出来的外部约束,记录在此以免未来有人往 CI/CD 自动部署或云厂商专有服务(RDS、Serverless)方向"优化"。
