# Chat Exporter 构建、取包与 Chrome Web Store 发布手册

最后更新：2026-05-22（v0.1.5）

本文说明如何在本仓库触发 GitHub Actions 构建、获取可上传到 Chrome Web Store 的 ZIP 文件，以及如何完成首次发布和后续更新。

## 当前仓库状态

- 仓库：`nextclaw/chat-exporter-extension`
- 默认分支：`main`
- 构建 workflow：`.github/workflows/ci.yml`
- workflow 名称：`CI`
- artifact 名称：`chat-exporter-extension`
- 本地打包命令：`npm run package`
- 本地打包输出：`release/chat-exporter-extension-v<package.version>.zip`
- 当前准备发布版本：`0.1.5`（按 `0.1.3` → `0.1.4` → `0.1.5` 顺序上传，每版都等前一版过审后再传，避免覆盖审核队列）

## 0.1.5 发布说明

- **弹窗预览**：导出前 popup 状态行显示对话标题与消息数，防止误导错 tab。
- **键盘快捷键 + 右键菜单**：`Ctrl/Cmd+Shift+E` 一键导出当前 tab；受支持页右键菜单加 "Export this chat"。两条直触发路径不开 popup，进度走工具栏 badge（"…" / "✓" / "!"），结果摘要写到 `chrome.storage.session` 下次打开 popup 时显示。
- **HTML 导出**：格式选择器加 HTML 选项；输出自包含 print-friendly 文档，浏览器打开后 Cmd+P → Save as PDF 即可。这是 PDF 需求的"不绑架"实现，未引入新依赖。
- **资产下载重试**：资产单文件失败前最多重试 2 次（指数退避 500ms/1500ms），文本文件仍是失败即终止。
- **新增 manifest 声明**：`contextMenus` 权限 + `commands` 顶层（快捷键）。商店描述里的 `Permission Justifications` 已加 `contextMenus` 一节。
- **重构**：`src/content/chatgptExtractor.ts`（1100+ 行）拆为 `src/content/extractors/{shared,chatgpt,gemini,claude,index}.ts`，纯 DX 改动，零用户可见。
- **CHANGELOG.md**：仓库根新增英文变更日志（中文详情仍在本文件）。

## 0.1.4 发布说明

- **新增导出格式选择器**：popup 在 Export 按钮上方提供 `Markdown (.md)` / `JSON (.json)` 两个复选框，按勾选输出对应文件；资产文件无论选什么都会下载。**默认只勾 Markdown**，普通用户得到干净的转录稿；需要 JSON 的开发者勾选一次后会被记住。
- **行为变更告知**：相对 0.1.3，默认导出从"MD + JSON 双输出"变成"仅 MD"。希望恢复双输出的老用户只需在 popup 勾上 JSON 一次，下次自动恢复（持久化到 `chrome.storage.local`）。
- **新增 `storage` 权限**：仅用来保存 popup 选中的格式，不做远端同步、不收集任何用户数据。商店描述里的 `Permission Justifications` 已加对应说明。

## 0.1.3 发布说明

- Manifest / popup / 构建校验小修：`action.default_icon` 补 48/128 像素图标；移除已停用的 `chat.openai.com` origin；popup 在 content script 不可达时显示真实错误信息；`chrome.scripting.executeScript` 显式声明 `world: ISOLATED` 与 `injectImmediately: false`；构建产物现在会扫静态 `import`、动态 `import()` 和 `import.meta`。
- Extractor 正确性与性能：保留包裹了 `<pre>` / `<code>` 的 `<button>`，不再把代码块跟着 Copy/Retry 按钮一并删除；`removeNoise` 改用 `textContent` 加 `childElementCount` 预筛；`harvestChatGptPayloads` 在 turn-anchor 模式下只采样当前滚入视口的 turn，长对话扫描复杂度从 O(N²) 降到 O(N)；Gemini / Claude 的 `compactRecords` 增加按 `role|text` 的精确匹配 Map，去重快速路径走 O(1)。
- 导出流水线 service worker 化：popup 现在仅承担 UI 与端口连接，点击 Export 后通过 `chrome.runtime.connect` 把任务交给 `assets/background.js`；SW 协调 content script 注入、文本文件编码成 `data:` URL、`chrome.downloads.download` 调度，并用 `chrome.downloads.onChanged` 跟踪到 complete/interrupted。popup 关闭不再中断长 ChatGPT 导出。
- 不包含 click-download、background capture、Claude Download button 捕获或任何页面元素自动点击下载能力（与 0.1.2 一致）。

当前 `CI` workflow 会在三种情况下运行：

- 推送到 `main`
- 创建或更新 pull request
- 在 GitHub Actions 页面手动运行

license、README、文档这类非代码变更，只要推送到 `main`，也会触发一次完整构建。需要注意的是，Chrome Web Store 上传包来自 `dist/`，如果某个仓库文件没有被构建复制到 `dist/`，它不会出现在最终扩展 ZIP 中。仅修改仓库 `LICENSE` 通常不需要重新发布商店版本；如果要把 license 文件也放进扩展包，需要另外把它纳入构建产物。

## 本地验证和打包

在提交或发布前，建议先本地跑一遍：

```bash
cd /opt/local/src/nextclaw/chat-exporter-extension
npm run typecheck
npm run lint
npm run test
npm run package
```

成功后会得到：

```text
release/chat-exporter-extension-v0.1.5.zip
```

检查这个 ZIP 是否能被 Chrome Web Store 接受的关键点：

```bash
unzip -l release/chat-exporter-extension-v0.1.5.zip | sed -n '1,60p'
```

输出中应该能看到根目录下的 `manifest.json`。Chrome Web Store 需要上传这个扩展 ZIP 本身，不能上传整个仓库，也不能上传 `dist/` 外层目录。

## 如何触发 GitHub 构建

### 方法一：推送到 main

如果你已经更新了 license：

```bash
cd /opt/local/src/nextclaw/chat-exporter-extension
git status --short
git add LICENSE
git commit -m "update license"
git push origin main
```

推送成功后，GitHub 会自动运行 `CI`。

如果 license 已经提交，只需要确认最新 commit 已经推到远端：

```bash
git status --short --branch
git log --oneline -5
git push origin main
```

### 方法二：在 GitHub 网页手动触发

1. 打开仓库：`https://github.com/nextclaw/chat-exporter-extension`
2. 进入 `Actions`
3. 左侧选择 `CI`
4. 点击 `Run workflow`
5. 分支选择 `main`
6. 再次点击 `Run workflow`

这个按钮来自 workflow 里的 `workflow_dispatch` 配置。GitHub 要求手动运行的 workflow 文件必须已经在默认分支上，并且操作者需要仓库写权限。

### 方法三：用 GitHub CLI 手动触发

如果本机已经登录 `gh`：

```bash
cd /opt/local/src/nextclaw/chat-exporter-extension
gh workflow run ci.yml --ref main
```

查看最近的构建：

```bash
gh run list --workflow=ci.yml --branch main --limit 10
```

等待指定 run 完成：

```bash
gh run watch <run-id>
```

查看失败日志：

```bash
gh run view <run-id> --log-failed
```

## 如何获取 ZIP 文件

### 方法一：GitHub 网页下载

1. 打开仓库 `Actions`
2. 点击最新成功的 `CI` run
3. 在页面底部找到 `Artifacts`
4. 点击 `chat-exporter-extension` 下载
5. 解压下载到本地的 artifact
6. 找到里面的 `chat-exporter-extension-v0.1.5.zip`

注意：GitHub 下载的 artifact 本身通常也是一个 ZIP。Chrome Web Store 要上传的是 artifact 里面的扩展 ZIP，也就是 `chat-exporter-extension-v0.1.5.zip`。

GitHub 默认会保存构建日志和 artifacts 90 天，仓库设置可以调整保留时间。下载 artifact 需要登录 GitHub，并且对仓库有读取权限。

### 方法二：GitHub CLI 下载

先找到最新成功 run：

```bash
gh run list --workflow=ci.yml --branch main --status success --limit 5
```

下载 artifact：

```bash
mkdir -p release-artifacts
gh run download <run-id> -n chat-exporter-extension -D release-artifacts
```

下载后应能看到：

```text
release-artifacts/chat-exporter-extension-v0.1.5.zip
```

这个文件就是 Chrome Web Store 上传文件。

### 方法三：本地直接取包

如果你已经在本地跑过：

```bash
npm run package
```

则直接使用：

```text
/opt/local/src/nextclaw/chat-exporter-extension/release/chat-exporter-extension-v0.1.5.zip
```

## 发布前检查清单

发布前建议确认：

- `npm run typecheck` 通过
- `npm run lint` 通过
- `npm run test` 通过
- `npm run package` 通过
- 上传包 ZIP 根目录包含 `manifest.json`
- `public/manifest.json` 中的 `version` 是要发布的版本
- 如果是更新已有商店版本，`manifest.version` 必须大于上一版
- `STORE-LISTING.md` 的英文商店文案已经准备好
- `STORE-LISTING-cn.md` 的中文文案已经准备好
- `PRIVACY.md` 已经在公开 URL 可访问
- 扩展图标已经包含在 `public/icons/`
- 至少准备一张商店截图，建议尺寸 `1280x800`
- 准备一张小型宣传图，尺寸 `440x280`

Chrome 官方文档说明，扩展上传包必须是 ZIP，且 `manifest.json` 要位于 ZIP 根目录。商店素材通常需要扩展图标、小型宣传图和至少一张截图。

## 首次发布到 Chrome Web Store

首次发布建议手动完成，因为商店条目需要先创建，并且 Store Listing、Privacy、Distribution、Test instructions 等信息要在 Developer Dashboard 里填写。Chrome Web Store API 更适合后续已有条目的自动化上传和发布。

### 1. 准备开发者账号

1. 打开 Chrome Developer Dashboard：`https://chrome.google.com/webstore/devconsole`
2. 使用准备用来发布扩展的 Google 账号登录
3. 如果是首次使用，注册 Chrome Web Store developer account
4. 按提示同意协议并支付一次性注册费用
5. 在 `Account` 页面补齐 publisher name、联系邮箱等信息

如果这是团队项目，可以后续设置 group publisher。个人首次发布可以先使用 individual publisher。

### 2. 上传扩展包

1. 打开 Developer Dashboard
2. 点击 `Add new item`
3. 选择 `chat-exporter-extension-v0.1.5.zip`
4. 点击上传
5. 如果 manifest 和 ZIP 有效，Dashboard 会进入条目编辑页面

不要上传 GitHub artifact 的外层 ZIP，也不要上传 `dist/` 文件夹本身。

### 3. 填 Store Listing

建议直接使用仓库里的英文文案：

```text
STORE-LISTING.md
```

建议填写：

- Name: `Chat Exporter`
- Category: `Productivity`
- Language: `English`
- Short description: 使用 `STORE-LISTING.md` 中的短描述
- Detailed description: 使用 `STORE-LISTING.md` 中的详细描述
- Screenshots: 至少 1 张，建议展示真实 popup 和导出结果
- Small promotional image: `440x280`

如果要提供中文本地化文案，可以参考：

```text
STORE-LISTING-cn.md
```

### 4. 填 Privacy

按当前插件实现，建议这样填写：

- Single purpose: 导出当前支持的 AI 聊天对话页为本地 JSON、Markdown 和资产文件
- Remote code: 选择不使用远程代码
- Data collection: 插件不把对话内容发送给开发者、第三方或远程服务；只在用户点击 Export 后在本地读取当前页面 DOM 并保存本地文件
- Privacy policy URL: `https://github.com/nextclaw/chat-exporter-extension/blob/main/PRIVACY.md`

权限说明可以使用 `STORE-LISTING.md` 中的 `Permission Justifications`：

- `activeTab`: 用户打开 popup 后识别并处理当前受支持的会话标签页
- `scripting`: 当 Chrome 尚未注入 packaged content script 时，向当前受支持标签页注入扩展自带脚本
- `downloads`: 保存生成的 JSON、Markdown 和资产文件
- content script matches: 仅限 ChatGPT、Gemini、Claude 页面，用于读取当前会话 DOM

### 5. 填 Distribution

常见选择：

- 首次 smoke test：可以先选 trusted testers 或 unlisted
- 准备公开分发：选择 public
- 国家和地区：按你的发布策略选择
- 价格：当前插件建议免费

如果你不确定审核结果，建议首次使用 deferred publishing：审核通过后先暂存，再由你手动发布。

### 6. 填 Test instructions

可以使用 `STORE-LISTING.md` 中的测试说明：

```text
1. Open a supported conversation page:
   - https://chatgpt.com/c/<conversation_id>
   - https://gemini.google.com/app/<conversation_id>
   - https://claude.ai/chat/<conversation_id>
2. Open the Chat Exporter extension popup.
3. Click Export.
4. Confirm that JSON and Markdown files are downloaded locally, plus asset files when the conversation contains images or static download links.

No test account is provided. Reviewers can use any account that can access a supported conversation page.
```

如果 Google 审核员无法访问真实会话页，可以补充一个测试账号或更详细的测试页面说明。

### 7. 提交审核

1. 确认 `Package`、`Store Listing`、`Privacy`、`Distribution`、`Test instructions` 没有红色必填项
2. 点击 `Submit for Review`
3. 根据需要选择审核通过后自动发布，或选择审核通过后手动发布
4. 等待审核结果邮件和 Dashboard 状态更新

审核完成时间取决于条目内容、权限、数据处理声明等因素。因为本插件权限较少、不使用远程代码、不上传用户数据，审核风险相对更低，但仍以 Chrome Web Store 审核结果为准。

## 发布后更新版本

发布已有条目的新版本时：

1. 更新代码
2. 增加 `public/manifest.json` 的 `version`
3. 同步更新 `package.json` 的 `version`
4. 运行验证：

```bash
npm run typecheck
npm run lint
npm run test
npm run package
```

5. 提交并推送：

```bash
git add public/manifest.json package.json package-lock.json
git commit -m "bump extension version"
git push origin main
```

6. 从 GitHub Actions 下载新的 `chat-exporter-extension-v<version>.zip`
7. 在 Developer Dashboard 打开已有条目
8. 上传新 ZIP
9. 更新商店文案或隐私声明（如果有变化）
10. 提交审核

Chrome Web Store 对已有扩展更新要求新上传版本号必须大于上一版；如果没有增加 manifest version，上传会失败。

## 后续发布自动化

当前 GitHub Actions 已经自动完成构建和产物上传，但不会自动发布到 Chrome Web Store。这是刻意保守的设置：首次发布需要人工填写 Dashboard 信息，也避免 CI 在未确认的情况下直接提交审核。

如果后续希望自动发布，可在首次手动创建商店条目后，再添加单独的 release workflow。

需要准备的 GitHub Secrets：

- `CWS_PUBLISHER_ID`
- `CWS_EXTENSION_ID`
- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`

Chrome Web Store API 的基本前提：

- 发布或更新需要 Google 账号启用两步验证
- 首次新条目仍需要在 Developer Dashboard 填完 Store Listing 和 Privacy
- API token 必须属于有权限管理该商店条目的账号或 publisher
- 上传已有条目的新包时必须先增加 manifest version

获取这些值的建议流程：

1. 在 Google Cloud Console 创建或选择一个项目
2. 启用 `Chrome Web Store API`
3. 配置 OAuth consent screen
4. 创建 OAuth client，类型选择 `Web application`
5. 把 `https://developers.google.com/oauthplayground` 加入 authorized redirect URIs
6. 记录 OAuth client ID 和 client secret
7. 打开 OAuth Playground，启用自定义 OAuth credentials
8. 使用 scope `https://www.googleapis.com/auth/chromewebstore` 授权
9. 用拥有该 Chrome Web Store 条目权限的 Google 账号登录
10. Exchange authorization code，取得 refresh token
11. 在 Developer Dashboard 的 `Account` 页面找到 publisher ID
12. 在扩展条目 URL 或条目详情中找到 extension ID
13. 到 GitHub 仓库 `Settings` -> `Secrets and variables` -> `Actions` 添加上述 secrets

如果后续使用 service account，也要确保它被授予管理该 Chrome Web Store 条目的权限。OAuth refresh token 对个人/小团队流程更直观，但要妥善保护，不能写入仓库。

可以采用两阶段自动化：

1. `main` 推送只构建 artifact
2. GitHub Release 或手动 `workflow_dispatch` 才上传并提交 Chrome Web Store 审核

示例思路如下，仅作为后续 workflow 参考：

```yaml
name: Publish Chrome Web Store

on:
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run package
      - name: Upload and publish
        env:
          CWS_PUBLISHER_ID: ${{ secrets.CWS_PUBLISHER_ID }}
          CWS_EXTENSION_ID: ${{ secrets.CWS_EXTENSION_ID }}
          CWS_CLIENT_ID: ${{ secrets.CWS_CLIENT_ID }}
          CWS_CLIENT_SECRET: ${{ secrets.CWS_CLIENT_SECRET }}
          CWS_REFRESH_TOKEN: ${{ secrets.CWS_REFRESH_TOKEN }}
        run: |
          TOKEN="$(curl -sS https://oauth2.googleapis.com/token \
            -d client_secret="${CWS_CLIENT_SECRET}" \
            -d grant_type=refresh_token \
            -d refresh_token="${CWS_REFRESH_TOKEN}" \
            -d client_id="${CWS_CLIENT_ID}" | jq -r '.access_token')"

          ZIP_FILE="$(ls release/chat-exporter-extension-v*.zip | head -n 1)"

          curl -sS -H "Authorization: Bearer ${TOKEN}" \
            -X POST \
            -T "${ZIP_FILE}" \
            "https://chromewebstore.googleapis.com/upload/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}:upload"

          curl -sS -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" \
            -X POST \
            -d '{}' \
            "https://chromewebstore.googleapis.com/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}:publish"
```

建议先让自动化只做到 `upload`，仍由人工在 Dashboard 里检查后提交审核。确认流程稳定后，再把 `publish` 纳入 workflow。

## 常见问题

### Actions 页面看不到 Run workflow

确认：

- `.github/workflows/ci.yml` 已在 `main`
- 当前 GitHub 账号有仓库写权限
- 仓库 Actions 没有被禁用
- 选择的是左侧 `CI` workflow

### 构建成功但找不到 ZIP

进入对应 run 页面底部的 `Artifacts` 区域找 `chat-exporter-extension`。如果没有 artifact，说明 `Package extension` 或 `Upload extension package` 步骤失败，需要看该 run 的日志。

### 下载后有两个 ZIP

这是正常的。GitHub artifact 下载下来可能是外层 ZIP。先解压外层 ZIP，里面的 `chat-exporter-extension-v0.1.5.zip` 才是 Chrome Web Store 上传包。

### Chrome Web Store 提示 manifest 不合法

先检查上传的是否是扩展 ZIP，而不是 artifact 外层 ZIP。再检查：

```bash
unzip -l chat-exporter-extension-v0.1.5.zip | sed -n '1,60p'
```

`manifest.json` 必须在 ZIP 根目录。

### Chrome Web Store 提示版本号重复或太低

更新 `public/manifest.json` 的 `version`，并同步更新 `package.json`。重新运行 `npm run package` 后再上传。

### 只改了 LICENSE，要不要发布新版

通常不需要。仓库 license 会通过 GitHub 展示；Chrome Web Store 扩展包是否包含 license 取决于构建产物。只有当你需要商店包或商店页面反映某个变更时，才需要发布新版。发布新版时仍然要增加 manifest version。

## 官方参考

- GitHub 手动运行 workflow：https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
- GitHub 下载 workflow artifacts：https://docs.github.com/actions/managing-workflow-runs/downloading-workflow-artifacts
- Chrome Web Store 注册开发者账号：https://developer.chrome.com/docs/webstore/register/
- Chrome Web Store 准备扩展：https://developer.chrome.com/docs/webstore/prepare/
- Chrome Web Store 发布扩展：https://developer.chrome.com/docs/webstore/publish/
- Chrome Web Store 隐私字段：https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/
- Chrome Web Store 图片素材：https://developer.chrome.com/docs/webstore/images
- Chrome Web Store API：https://developer.chrome.com/docs/webstore/using_webstore_api
