# 零基础 GitHub Pages 部署步骤

本仓库部署为 GitHub Pages 静态网站。网站使用者不用安装软件；以下操作由仓库拥有者完成。**本地构建或测试成功不表示网站已上线。**

## 第一步：把这一版代码放入 main

改造需包含 package.json、package-lock.json、index.html、src、public、models/manifest.json、scripts、测试、配置和 `.github/workflows/pages.yml`。public/ocr/tessdata 内两个免费模型是部署必需文件，不能省略；它们随源码保存，无需 API Key。

若改造分支已经推送：

1. 打开 graceyc1025/ancient-text-transcriber 仓库，进入 **Pull requests**。
2. 点 **Compare & pull request**。确认 **base: main**、compare 为改造分支，再点 **Create pull request**。
3. 检查 **Files changed**，确认是浏览器版和 Pages 工作流。
4. 等待 **Build and deploy GitHub Pages / build** 检查完成。Pull Request 不会发布网站。
5. 检查通过后由您点击 **Merge pull request** → **Confirm merge**。main 有保护规则时，按仓库审批要求操作。

如果尚未成功推送分支，还需 GitHub 写入授权。不要把 token 或密码发在聊天中；通过当前 GitHub 集成授权流程提供仓库写入权限，再重试推送。修改 .github/workflows 可能还需工作流写入权限，取决于凭据类型。Git 读取成功不能证明写入或 API 权限可用。

也可用 GitHub Desktop 将完整改造文件提交到新分支、推送并创建 PR。不要只上传 dist，不要提交 node_modules、私人图片或测试输出。网站使用者不用本地构建。

## 第二步：启用 Pages

1. 在仓库顶部点击 **Settings**。
2. 左侧点击 **Pages**。
3. 在 **Build and deployment** → **Source** 下拉框选择 **GitHub Actions**。
4. 不必选择 gh-pages 分支、docs 文件夹或 Python 部署平台。
5. 看不到 Pages 或不能更改 Source 时，需具有仓库管理员权限；私有仓库的 Pages 可用性还取决于 GitHub 套餐，以设置提示为准。

## 第三步：运行工作流

合并到 main 会自动触发部署。如果合并时 Pages 还未启用，deploy 可能失败；完成第二步后重跑：

1. 点击仓库顶部 **Actions**。
2. 左侧选择 **Build and deploy GitHub Pages**。
3. 若 Actions 被禁用，按 GitHub 提示启用该仓库的 Actions。
4. 点 **Run workflow**，选分支 **main**，再点 **Run workflow**。
5. 等待 **build** 和 **deploy** 都显示绿色。build 会安装锁定依赖、检查模型、构建网页并运行真实浏览器 OCR/下载测试，首次可能几分钟。
6. 如果 github-pages 环境要求审批，按仓库要求确认本次部署。

工作流使用 GitHub 自动提供的临时 GITHUB_TOKEN 和 Pages/OIDC 权限，不需要额外 OCR API Key。组织政策禁止 Pages 写入或这些 Actions 时，由管理员调整适用于本次部署的权限；不能把密钥放进网页。

## 第四步：验证固定网址

1. 回到 **Settings → Pages**，点击 GitHub 显示的 **Visit site**。
2. 当前仓库的预期地址为 `https://graceyc1025.github.io/ancient-text-transcriber/`；这只是推导地址，最终以设置和成功部署输出为准。
3. 打开网页，确认样式正常，点击竖排排版演示或选择自己的 JPG/PNG，等待真实识别。
4. 改一处文字，复制并导出 TXT/Word，打开下载文件确认文字与原图对应。
5. 仍看到旧版时，等待 Pages 生效并强制刷新缓存。workflow 绿色不能替代网站功能验证。

完成这些步骤后才可说网站上线可用。网址通常保持固定；仓库改名、用户名变更或自定义域名设置会改变网址。

## 以后重新发布

以后每次改源码、通过 PR 检查并合并到 main，工作流自动重新构建和发布。无需手动上传 dist、重新配置 Pages 或替换未变化的模型。也可按第三步在 main 手动运行。

回退可用 GitHub 的 Revert 创建回退 PR，合并后重新发布。不要随意删除源文件来重置部署。

## 常见部署错误

| 提示 | 下一步 |
| --- | --- |
| npm ci 失败 | 确认 package.json 与 lock 一起更新；依赖网络故障恢复后重跑 |
| 模型哈希校验失败 | 恢复来源明确的正确模型，不关闭校验或随意改哈希 |
| 浏览器检查失败 | 下载该运行的 browser-test-report artifact 查看截图/trace，修复后重跑，不能跳过失败检查发布 |
| Pages 未配置 | Settings → Pages 将 Source 设为 GitHub Actions，再在 main 重跑 |
| 权限/OIDC 错误 | 检查 pages: write、id-token: write 与组织/环境审批政策 |
| PR 没有 deploy | 正常，合并到 main 后才部署 |
| 模型找不到或子路径异常 | 检查 public 模型随提交存在、WASM 构建复制成功，并运行项目子路径测试 |
| 仍显示 Python 安装说明 | 确认已合并这一版，并刷新网页缓存；本版没有 Python 后端 |

GitHub 授权、main 合并、Pages 启用和环境审批须按您的账号权限操作。工具不能因 API 无权限而声称这些步骤已完成。
