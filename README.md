# 古籍文献图片转录助手 · GitHub Pages 版

纯前端个人学术研究工具。使用者打开网站即可选择 JPG / PNG，在浏览器本地识别繁体竖排文字、对照原图校勘、复制或导出 TXT / Word。**使用者不需要安装 Python、Tesseract、Node.js 或其他软件，不需要 API Key，不调用付费服务。**

本实验分支保留默认 Tesseract，新增 PaddleOCR 整页/整区试用选项；[双引擎测试说明](docs/双引擎实验版本测试说明.md)记录当前支持范围，尚未发布到正式站。

网站由 GitHub Pages 托管静态文件，识别由所选引擎的 Web Worker / WebAssembly 在使用者的浏览器运行；编辑及 DOCX 生成也在浏览器完成。引擎、WASM 和模型均来自本站，无第三方 CDN、OCR 服务器、数据库或 Python 后端。

**当前引擎是通用繁体 OCR，未专门针对清代古籍训练。能运行繁体竖排识别，不代表能可靠识别异体字、复杂版式和残损文字。它只能生成需要逐字核对的校勘底稿。** 低置信度替换为□无法覆盖漏检或高置信度误识。最新同图对照、检测问题及手机验证边界见[OCR排查与优化](docs/OCR排查与优化.md)，初版测量见[原测试报告](docs/测试报告.md)。

## 使用与部署

针对“大量□、有效文字极少”的最新核查见[方框问题诊断](docs/方框问题诊断.md)：已核对实际加载模型哈希、冷/热缓存与原始输出；仅修复初始化失败延迟报错，不宣称OCR精度提高，并评估免费浏览器替代引擎。

- 网站使用者：[使用说明](使用说明.md)
- 仓库拥有者：[零基础 GitHub Pages 部署步骤](docs/GitHub-Pages部署.md)
- 技术支持范围：[技术方案](docs/技术方案.md)
- 引擎与模型许可：[第三方说明](THIRD_PARTY_LICENSES/说明.md)

项目网址为 `https://graceyc1025.github.io/ancient-text-transcriber/`；拥有者反馈现有版本已部署，本次优化仍在独立分支，尚未发布。请以 GitHub 的 Settings → Pages 地址及实际浏览器验证为准。现有 `.github/workflows/pages.yml` 继续使用 GitHub Actions 来源；本次PR检查不部署，合并到 `main` 后工作流才发布新版本。

## 功能

- 批量 JPG / PNG、本页及待处理页识别、逐页结果、目录重排。
- 繁体竖排 `chi_tra_vert` / 横排 `chi_tra` 模型；尽量按几何列序从右至左、从上至下输出，不做简繁转换、断句、标点补全或上下文润色。
- 低置信度检测字词标□及原图位置提示；原图缩放、人工框选正文/标题/页码/版心/其他区域。
- 自动投影/指定列数的竖排分栏，右至左逐列识别；区域独立识别与排版/PSM设置。
- 可选放大、灰度、对比度、全局/局部/手动二值化，原图与处理预览；实际检测框及工作图预算提示。
- 原始OCR文本、TSV坐标与参数历史，复制原始输出、本页JSON记录下载；停止及超时提示。
- 编辑、栏目重排、已校对标记；识别失败保留既有人工文字。
- 本页/全部复制、UTF-8 BOM TXT、可附对应图片的 DOCX，导出当前编辑内容。
- 图片不上传；关闭或刷新前需导出，没有自动恢复功能。

模型和 WASM 首次使用需从本站下载约 16 MB（所选语言及引擎），下载后可以缓存模型；不承诺完整离线重开网页。识别占用浏览器 CPU 和内存，建议先用几张清晰图片测试，复杂版面按列/夹注分区。

## 开发者维护

以下命令仅供维护代码的人使用，**网站使用者无需执行**。维护环境为 Node.js 24，依赖由 `package-lock.json` 锁定。

```bash
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

构建产物为 `dist/`，只含 HTML/CSS/JS、样例、OCR Worker/WASM 和繁体模型。Vite 使用 `base: './'`；浏览器模型/Worker 路径从页面 URL 相对解析，可用于 GitHub Pages 项目子路径和独立域名根路径。浏览器测试把产物实际挂在 `/ancient-text-transcriber/`，并检查所有网络请求仅为本站 GET/HEAD，不含识别/导出 API。

`npm run dev` 提供代码开发；`npm run preview` 预览生产产物；`node scripts/serve-static.mjs` 为子路径验证提供只读静态测试服务，它不做 OCR。`npm run test:ocr-samples -- /path/to/scan.png` 可以通过真实浏览器记录扫描输出，未标注扫描不报告准确率。

`npm run test:ocr-comparison -- /path/to/scan.png` 比较基线 `e323b56` 与当前源码（需本地保有该提交），输出到忽略的 `test-results/ocr-before-after.json`；`OCR_BASE_REF` 可指定基线。现代演示图有30字真值，未标注扫描仅统计输出，不推算古籍错识/漏识率。后续运行Playwright会清理test-results，请先备份比较记录。

Pull Request 触发构建与测试，不发布；合并到 `main` 后自动重新发布，也可从 Actions 手动运行工作流。不要将私人文献图片、测试输出、密钥、`node_modules` 或 `dist` 提交到仓库。
