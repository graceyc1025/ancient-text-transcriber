# PaddleOCR.js 独立可行性实验

实验分支 `experiment/paddleocr-v5-browser` 从未合并的 `fix/ocr-square-diagnosis` 派生。正式入口、Tesseract功能、根依赖及Pages工作流没有因本实验而改变。**此目录不是已部署的网站，也不会自动发布。**

新增的同图四方法、人工标准、严格CER及记录导出功能，见[清代古籍对照测试操作](../../docs/清代古籍对照测试操作.md)。仓库仍缺可靠的清代图片与标准文本配对，需用户提供，**未证明更适合清代刻本或行草**。

本轮[工具验收记录与实际输出](../../docs/清代对照工具验收记录.md)使用现代演示图，只证明流程可用；完整机器记录随文保留，清代样本准确率未测试。

最初可行性结论与实际输出见[历史实验报告](../../docs/PaddleOCR浏览器实验报告.md)。其中旧参数和现代图数据保留为历史证据，不代表本轮新管线结果。当前管线标记为 `raw-candidate-comparison-v2`，两引擎默认共用原尺寸，默认分栏数须按真实图调整；结果保存原生与几何顺序文本、实际参数，不以置信度隐藏候选。

## 实际使用的模型

- 官方 `@paddleocr/paddleocr-js` 0.4.2，ONNX Runtime Web 1.22.0，OpenCV.js 4.10.0-release.1，全部固定于本目录独立lockfile。
- 官方BCE模型包域名在实验环境被代理拒绝；实际运行采用 `pdfmarkdown-ppocrv5-models@1.0.0` 的**社区导出版**PP-OCRv5 mobile：ORT格式检测权重、ONNX格式识别权重。不能声称与未取得的官方原始tar包逐字节相同。
- npm压缩包SHA-512完整性、上游固定提交Git LFS的权重SHA-256、打包后tar SHA-256均固定。权重没有修改；模型格式记录在models.json。
- 使用官方固定提交的18,383项字典。社区包字典多一空项及尾部空格，与官方SDK的CTC解码约定不匹配，因此不直接使用它；字典哈希固定，并与权重输出类别及已知文本检查相互验证。标准文本只用于结果评分，从不传给OCR。
- `import-community-models.mjs` 生成SDK所需的ustar资源：inference.yml由固定配置生成；检测数据虽然是ORT格式，放在SDK约定的inference.onnx条目内，由ONNX Runtime识别真实格式。完整来源与格式差异必须随结果保留。

## 开发者复现

网站使用者无需安装。以下仅供维护实验的人使用，需要Node.js 24、npm、tar、Chromium和原项目根依赖：

```bash
# 在仓库根目录，准备既有Tesseract资源
npm ci --cache /tmp/ancient-transcriber-npm-cache
node scripts/prepare-runtime.mjs

cd experiments/paddle
npm ci --ignore-scripts --cache /tmp/ancient-transcriber-npm-cache
npm pack pdfmarkdown-ppocrv5-models@1.0.0 --ignore-scripts --pack-destination /tmp --cache /tmp/ancient-transcriber-npm-cache
node import-community-models.mjs /tmp/pdfmarkdown-ppocrv5-models-1.0.0.tgz
npm run build
npm test
npm run test:case
node browser-check.mjs
npm run benchmark
# 已有本地扫描的可选对照；路径相对本目录
npm run benchmark -- ../../tests/samples/local/page_2.png ../../tests/samples/local/maoshi.png
```

`npm run dev` 启动开发服务；`node serve.mjs` 为内部测试提供项目子路径的只读静态服务。它没有上传或识别接口。`npm run build`生成本目录dist，**不要覆盖根dist或运行正式部署工作流**。默认benchmark逐配置新建浏览器，每种3次，结果写results/comparison.json。可用PADDLE_BENCHMARK_OUTPUT指定输出路径，BENCHMARK_PROFILE仅补测指定配置。

网页支持上传图片、导入人工UTF-8 TXT、预览自定栏边界、依次运行四方法、查看原始候选与逐字差异、下载输入清单/完整JSON/CSV。标准含□或尚未确认校对时不计算CER。普通网页仅有主页面JS堆补充信息，不提供虚假的总内存峰值。需要独立桌面PSS采样：`npm run benchmark:case -- --case /path/input.json --image /path/scan.png --out results/case.json`，详见操作文档。`npm run test:case`使用真实现代图OCR验收流程及故障处理，不能替代清代准确率评测。

模型、node_modules、dist和原始扫描结果均忽略，不提交私人文献。构建时模型缺失会明确记录不可用，界面不会返回模拟文字。未取得的官方原始资源位置记录于official-sources.json；如另做官方包对照，应使用独立清单，不要覆盖社区模型哈希或混写结果。

## 静态部署条件与验证边界

只需静态文件，无付费API、API Key、Python或数据库。相对base、同源模型、ORT mjs/wasm、UTF-8及正确MIME须保留。实测挂载路径为 `/ancient-text-transcriber/experiments/paddle/`，没有COOP/COEP响应头，crossOriginIsolated=false，强制单线程WASM、禁用ORT代理、不依赖WebGPU。

当前OpenCV构建需要script-src中的unsafe-eval；实验页面已单独设置，正式网站CSP未放宽。OpenCV内嵌WASM用data:资源，实验connect-src允许本地data:，没有第三方连接。前端推理选择main-thread模式，长图时界面会短暂停顿，尚不作为正式产品实现。

SDK默认框顺序偏横排。本实验保留原始SDK结果，再按坐标从右到左、同列上到下排列；不改繁简、不补标点或上下文文字。均分3栏仅用于已知3栏的实验图，不能默认用于任意古籍。代码没实现可靠的古籍版面分类、自动方向分类或异体字复原。

桌面真实Chromium、触屏手机模拟、重复推理和缺模型故障已测；**未部署到GitHub Pages，未进行Android/iPhone/Safari/Firefox实机测试，不能宣称所有手机稳定**。当前峰值内存和首次资源体积明显高于Tesseract，需要有来源的清代真值集和实机评测后再决定下一步。

## 许可

PaddleOCR、模型社区分发、官方字典：Apache-2.0。ONNX Runtime：MIT。OpenCV 4.x：Apache-2.0（相关组件保留各自声明）。SDK还依赖clipper-lib、js-yaml；按其包内声明保留许可。本目录licenses保存模型/字典适用的Apache许可；构建生成的licenses目录保留使用的包许可说明。没有订阅或OCR调用费用，下载流量、计算资源及托管仍受使用平台规则约束。
