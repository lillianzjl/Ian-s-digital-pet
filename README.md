# Ginger 🐹 — Ian 的 3D 仓鼠朋友

照着 Ian 家里真正的仓鼠 Ginger 做的：奶油色叙利亚仓鼠，大粉耳朵，白肚皮。

全屏网页里站着的一只 3D 小仓鼠，会做可爱动作，能用美式英语和 Ian 聊天、陪他读书。

## 两个页面

| 页面 | 地址 | 给谁用 |
|---|---|---|
| Ian 的页面 | `/` | Ian：按麦克风说话，点仓鼠摸头，喂瓜子、跳舞、一起读书 |
| 家长页 | `/parent` | 家长：设置阅读主题和说明，拍照或上传书页、PDF，查看聊天记录 |

## 说明

- **语音**：浏览器自带的美式英语 (en-US) 朗读，自动优先选男声，语速 0.85。在 Ian 页面右上角 ⚙️ 可以换声音，选择保存在这台设备上。
- **适合 6 岁**：仓鼠只用简单英语短句回答，一次只问一个问题，不谈不适合孩子的话题，也不会问个人信息（规则在 `lib/claude.js`）。
- **阅读材料**：家长上传后，Claude 会识别出文字，再整理出重点词和问题。识别结果可以在家长页修改；勾选“今天读这个”后，仓鼠就会陪 Ian 读这份材料。
- **语音识别**：麦克风使用浏览器的语音识别（en-US），Chrome 和 iPad/iPhone 的 Safari 都支持。如果浏览器不支持，可以点 ⌨️ 打字。

## 运行

```bash
npm install
ANTHROPIC_API_KEY=你的密钥 PARENT_PIN=1234 npm start
# 打开 http://localhost:3000 ，家长页是 http://localhost:3000/parent
```

| 环境变量 | 作用 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API 密钥（在 console.anthropic.com 创建）。不设置就是演示模式，仓鼠用预设回复 |
| `PARENT_PIN` | 家长页的密码，不设置则不需要密码 |
| `SITE_PASSWORD` | 整个网站的密码（放到网上时一定要设）。浏览器第一次打开会弹窗，用户名随便填，密码填这个 |
| `CHATS_PER_HOUR` | 每小时最多聊几句，防止意外花钱，默认 60 |
| `CHATS_PER_DAY` | 每天最多聊几句，默认 150 |
| `PORT` | 端口，默认 3000 |
| `DATA_DIR` | 上传文件和设置的存放位置，默认 `./data` |
| `CHAT_MODEL` | 聊天用的模型，默认 `claude-haiku-5-5`（便宜） |
| `READ_MODEL` | 识别书页用的模型，默认 `claude-opus-5-5`（识字准） |

密钥只放在服务器上，不会发到网页里，Ian 那边的浏览器看不到。

## 放到网上（Railway）

Railway 可以直接从 GitHub 部署，还能挂一个硬盘保存上传的照片和设置。Hobby 套餐大约每月 5 美元，以官网价格为准。

1. 用 GitHub 账号登录 railway.com，点 **New Project → Deploy from GitHub repo**，选 `Ian-s-digital-pet`。
2. 进入服务的 **Settings**：
   - **Source → Branch**：选代码所在的分支。
   - **Networking → Generate Domain**：生成一个网址，Ian 就用这个网址打开。
3. 右键服务 → **Attach Volume**，挂载路径填 `/data`。不挂的话，每次更新都会丢掉上传的材料。
4. 打开 **Variables**，添加：
   - `ANTHROPIC_API_KEY` = 你在 Claude Console 新建的密钥
   - `DATA_DIR` = `/data`
   - `SITE_PASSWORD` = 全家人用的网站密码
   - `PARENT_PIN` = 家长页密码，不要告诉 Ian
5. 等部署完成，打开网址，在 iPad Safari 里点 **分享 → 添加到主屏幕**，Ginger 就像一个 App 一样了。
