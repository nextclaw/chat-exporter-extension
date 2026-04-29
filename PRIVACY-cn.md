# 隐私政策

最后更新：2026-04-30

Chat Exporter 是一个本地运行的 Chrome 插件，用于把当前打开的 ChatGPT、Gemini 或 Claude 对话导出为 JSON 和 Markdown 文件。

## 单一用途

插件的单一用途是：把当前受支持的 AI 聊天对话页导出为用户本地保存的文件。

## 插件处理的数据

当用户在受支持的对话页点击 Export 时，插件会读取当前标签页的页面 DOM。这可能包含浏览器中可见的对话文本和渲染后的消息 HTML。

插件不会收集浏览历史、账号凭据、Cookie、支付信息、个人资料信息或分析数据。

## 数据用途

对话内容只会在浏览器本地处理，用来生成：

- rich JSON 导出文件；
- Markdown transcript。

生成的文件会通过 Chrome Downloads API 保存到本地。

## 数据共享

Chat Exporter 不会把对话内容传输给开发者、第三方、分析服务或远端服务器。插件不会出售、出租或共享用户数据。

## 远程代码

插件不会加载或执行远程托管代码。所有运行时代码都包含在打包后的扩展内。

## 权限说明

- `activeTab`：用户打开 popup 后，允许插件识别并处理当前活动标签页。
- `scripting`：当 Chrome 尚未向已打开的受支持对话页注入内容脚本时，允许插件注入扩展包内的 content script。
- `downloads`：用于把生成的 JSON 和 Markdown 文件保存到本地。

Host 访问范围仅限受支持的对话服务：ChatGPT、Gemini 和 Claude。

## 数据保留

插件不会在内部保存导出的对话内容。导出的文件由用户保存在本地位置。

## 联系方式

问题反馈请使用项目仓库：`https://github.com/nextclaw/chat-exporter-extension`。
